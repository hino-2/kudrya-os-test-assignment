import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { ADMIN_TOKEN_HEADER } from '../../src/admin/admin.constants';
import { AppConfigService } from '../../src/common/config/app-config.service';
import type { RedeliverResponseDto } from '../../src/admin/dto/redeliver.response.dto';
import { JOB_STATE } from '../../src/jobs/jobs.constants';
import { buildDeliverOrderDedupeKey } from '../../src/jobs/jobs.util';
import type { IJobRow } from '../../src/jobs/jobs.interfaces';
import { ORDER_STATUS } from '../../src/orders/orders.constants';
import type { CreateOrderResponseDto } from '../../src/orders/dto/create-order.response.dto';
import type { PaymentWebhookResponseDto } from '../../src/payments/dto/payment-webhook.response.dto';
import { ATTEMPT_STATE, DELIVERY_SOURCE } from '../../src/delivery/delivery.constants';
import { SUPPLIER_CODE } from '../../src/suppliers/suppliers.constants';
import { startApi } from '../helpers/app.harness';
import { startStub } from '../helpers/stub.harness';
import { TEST_ADMIN_TOKEN, TEST_WORKER_SUPPLIER_A_PORT, TEST_WORKER_SUPPLIER_B_PORT } from '../helpers/harness.constants';
import type { IApiHarness, IStubHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';
import { seedCatalog } from '../helpers/seed.helper';

interface IHttpResult<T> {
  status: number;
  body: T;
}

interface IOrderRow {
  status: string;
}

interface IDeliveryAttemptRow {
  supplier_code: string;
  attempt_no: number;
  state: string;
  delivery_generation: number;
  request_id: string;
  resolve_attempts: number;
}

interface IIssuedDeliveryRow {
  source: string;
  supplier_code: string | null;
  code: string;
}

// ответы заглушки поставщика — только для чтения в этом файле
interface IStubIssueBody {
  code: string;
}

interface IStubControlState {
  issuedCount: number;
}

// товар в режиме fulfillment_mode='supplier' — единственный такой SKU в сидере (см. seed.helper)
const SUPPLIER_SKU = 'STEAM-TOPUP-500';

const SUPPLIER_SKU_AMOUNT_MAJOR = 500;

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1 ORDER BY id';

const SELECT_ORDER_STATUS_BY_EXT_ID_SQL = 'SELECT status FROM orders WHERE ext_id = $1';

const SELECT_DELIVERY_ATTEMPTS_SQL = `
  SELECT da.supplier_code, da.attempt_no, da.state, da.delivery_generation, da.request_id,
         da.resolve_attempts
  FROM delivery_attempts da
  JOIN orders o ON o.id = da.order_id
  WHERE o.ext_id = $1
  ORDER BY da.id
`;

const SELECT_ISSUED_DELIVERIES_SQL = `
  SELECT id.source, id.supplier_code, id.code
  FROM issued_deliveries id
  JOIN orders o ON o.id = id.order_id
  WHERE o.ext_id = $1
`;

const POLL_STEP_MS = 25;

const POLL_TIMEOUT_MS = 5000;

// resolve-путь проходит весь бюджет дозвонов (5 прогонов джобы с экспоненциальным бэкоффом
// поставщика) до того, как дело доходит до GET /issue/:request_id — 5с здесь мало
const POLL_RESOLVE_TIMEOUT_MS = 20000;

let api: IApiHarness;

let stubA: IStubHarness;

let stubB: IStubHarness;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// поллинг вместо фиксированного sleep: тик реального @Interval не гарантирован на первой попытке.
// Строк с одним dedupe_key может быть несколько: jobs_live_uq частичный, поэтому повторная
// доставка (нового поколения) создаёт вторую строку рядом с уже завершённой первой.
async function pollJobsUntil(
  dataSource: DataSource,
  dedupeKey: string,
  predicate: (jobs: IJobRow[]) => boolean,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<IJobRow[]> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);

    if (predicate(rows)) {
      return rows;
    }

    await delay(POLL_STEP_MS);
  }

  throw new Error(`Задача ${dedupeKey} не перешла в ожидаемое состояние за ${timeoutMs}мс`);
}

async function pollJobUntil(
  dataSource: DataSource,
  dedupeKey: string,
  predicate: (job: IJobRow) => boolean,
  timeoutMs: number = POLL_TIMEOUT_MS,
): Promise<IJobRow> {
  const jobs = await pollJobsUntil(
    dataSource,
    dedupeKey,
    (rows) => rows[0] !== undefined && predicate(rows[0]),
    timeoutMs,
  );

  return jobs[0];
}

async function pollAttemptUntil(
  extId: string,
  predicate: (attempt: IDeliveryAttemptRow) => boolean,
  timeoutMs: number,
): Promise<IDeliveryAttemptRow> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = await fetchDeliveryAttempts(extId);
    const attempt = rows[0];

    if (attempt !== undefined && predicate(attempt)) {
      return attempt;
    }

    await delay(POLL_STEP_MS);
  }

  throw new Error(`Попытка выдачи заказа ${extId} не перешла в ожидаемое состояние за ${timeoutMs}мс`);
}

async function post<T>(
  baseUrl: string,
  path: string,
  payload: unknown,
  headers: Record<string, string> = {},
): Promise<IHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

async function getJson<T>(baseUrl: string, path: string): Promise<IHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`);
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

async function forceScenario(stub: IStubHarness, mode: string, times = 1): Promise<void> {
  const { status } = await post(stub.baseUrl, '/_control/scenario', { mode, times });

  expect(status).toBe(201);
}

async function resetStub(stub: IStubHarness): Promise<void> {
  const { status } = await post(stub.baseUrl, '/_control/reset', {});

  expect(status).toBe(201);
}

async function createOrder(sku: string): Promise<string> {
  const { body } = await post<CreateOrderResponseDto>(api.baseUrl, '/orders', { sku });

  return body.order_id;
}

async function payOrder(extId: string, amountMajor: number, eventId: string): Promise<void> {
  const { body } = await post<PaymentWebhookResponseDto>(api.baseUrl, '/webhooks/payment', {
    event_id: eventId,
    order_id: extId,
    status: 'paid',
    amount: amountMajor,
    currency: 'RUB',
    created_at: new Date().toISOString(),
  });

  expect(body.order_status).toBe(ORDER_STATUS.PAID);
}

async function fetchOrderStatus(extId: string): Promise<string> {
  const rows = await api.dataSource.query<IOrderRow[]>(SELECT_ORDER_STATUS_BY_EXT_ID_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row.status;
}

async function fetchDeliveryAttempts(extId: string): Promise<IDeliveryAttemptRow[]> {
  return api.dataSource.query<IDeliveryAttemptRow[]>(SELECT_DELIVERY_ATTEMPTS_SQL, [extId]);
}

async function fetchIssuedDeliveries(extId: string): Promise<IIssuedDeliveryRow[]> {
  return api.dataSource.query<IIssuedDeliveryRow[]>(SELECT_ISSUED_DELIVERIES_SQL, [extId]);
}

beforeAll(async () => {
  // рейты сбоев заглушек зануляем на обоих инстансах: дефолтная (не форсированная) выдача
  // всегда 'ok' — только явный _control/scenario вносит нужный сценарий в конкретном тесте
  const stubEnvBase = {
    STUB_FAIL_RATE: '0',
    STUB_TIMEOUT_RATE: '0',
    STUB_SLOW_RATE: '0',
    STUB_PERSIST_PATH: '',
  };

  // фиксированные порты: WORKER_ENABLED=true, SUPPLIER_A_BASE_URL/SUPPLIER_B_BASE_URL и
  // SUPPLIER_REQUEST_TIMEOUT_MS форсированы в env.setup.worker-enabled.ts (setupFiles проекта
  // integration-worker) ДО импорта AppModule — envOverrides в startApi() здесь не сработал бы
  // (см. комментарий в setup-файле), поэтому заглушки должны слушать именно эти порты
  stubA = await startStub({ ...stubEnvBase, SUPPLIER_ID: 'A' }, TEST_WORKER_SUPPLIER_A_PORT);
  stubB = await startStub({ ...stubEnvBase, SUPPLIER_ID: 'B' }, TEST_WORKER_SUPPLIER_B_PORT);

  api = await startApi();
});

afterAll(async () => {
  await api?.stop();
  await stubA?.stop();
  await stubB?.stop();
});

beforeEach(async () => {
  await resetDatabase(api.dataSource);
  await seedCatalog(api.dataSource);
  await resetStub(stubA);
  await resetStub(stubB);
});

describe('supplier delivery via the real scheduled job worker (WORKER_ENABLED=true)', () => {
  it('replays the same request_id after a client-side timeout and delivers on the retried job claim', async () => {
    await forceScenario(stubA, 'issue_then_hang', 1);

    const extId = await createOrder(SUPPLIER_SKU);

    await payOrder(extId, SUPPLIER_SKU_AMOUNT_MAJOR, 'evt_worker_supplier_replay');

    const job = await pollJobUntil(
      api.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
    );

    // первая claim ловит timeout (unknown, retry_required), вторая claim реплеит тот же
    // request_id и получает уже смятый код — attempts инкрементируется на каждой claim
    expect(job.attempts).toBe(2);
    expect(job.last_error).toBeNull();

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERED);

    const attempts = await fetchDeliveryAttempts(extId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      supplier_code: SUPPLIER_CODE.A,
      attempt_no: 1,
      state: ATTEMPT_STATE.SUCCEEDED,
    });

    const issued = await fetchIssuedDeliveries(extId);

    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ source: DELIVERY_SOURCE.SUPPLIER, supplier_code: SUPPLIER_CODE.A });
  });

  // H2, регрессия: A заминтил код, но API его ответа так и не увидел. После исчерпания бюджета
  // слепых POST-реплеев джоба обязана спросить у A авторитетно (GET /issue/:request_id) и выдать
  // именно код A — уход к B дал бы вторую выдачу на один оплаченный заказ, а первую потерял бы
  it('resolves an exhausted unknown attempt through the supplier lookup instead of falling back to B', async () => {
    const cap = api.get(AppConfigService).supplier.unknownMaxResolveAttempts;

    // ровно cap зависших POST: каждый переводит попытку в unknown и съедает один дозвон,
    // после чего форсированный сценарий сам сбрасывается в normal (все рейты нулевые ⇒ 'ok')
    await forceScenario(stubA, 'timeout', cap);

    const extId = await createOrder(SUPPLIER_SKU);

    await payOrder(extId, SUPPLIER_SKU_AMOUNT_MAJOR, 'evt_worker_supplier_resolve');

    const exhausted = await pollAttemptUntil(extId, (row) => row.resolve_attempts >= cap, POLL_RESOLVE_TIMEOUT_MS);

    // заглушка отвечает на реплей того же request_id мгновенно, поэтому состояние «код у A уже
    // есть, а слепой реплей его не покажет» воспроизводится прямым POST /issue в заглушку A:
    // это и есть окно H2 — заминтил, ответ потерян, бюджет реплеев исчерпан
    const minted = await post<IStubIssueBody>(stubA.baseUrl, '/issue', {
      request_id: exhausted.request_id,
      sku: SUPPLIER_SKU,
      order_id: extId,
    });

    expect(minted.status).toBe(200);

    const lookup = await getJson<IStubIssueBody>(stubA.baseUrl, `/issue/${exhausted.request_id}`);

    expect(lookup.status).toBe(200);
    expect(lookup.body.code).toBe(minted.body.code);

    const job = await pollJobUntil(
      api.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
      POLL_RESOLVE_TIMEOUT_MS,
    );

    // cap прогонов на слепые реплеи + один прогон на resolve-шаг
    expect(job.attempts).toBe(cap + 1);
    expect(job.last_error).toBeNull();

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERED);

    const attempts = await fetchDeliveryAttempts(extId);

    // ни одной новой попытки: фолбэк к B даже не рассматривался
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      supplier_code: SUPPLIER_CODE.A,
      attempt_no: 1,
      state: ATTEMPT_STATE.SUCCEEDED,
    });

    const issued = await fetchIssuedDeliveries(extId);

    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ source: DELIVERY_SOURCE.SUPPLIER, supplier_code: SUPPLIER_CODE.A });
    expect(issued[0].code).toBe(minted.body.code);

    const stateB = await getJson<IStubControlState>(stubB.baseUrl, '/_control/state');

    expect(stateB.body.issuedCount).toBe(0);
  });

  // H1, регрессия: 500 с HTML-телом (прокси/LB/ingress) не является ответом поставщика в его
  // контракте и не доказывает, что код не заминчен. Такой исход обязан быть неопределённым —
  // тогда повтор идёт тем же request_id. Если считать его определённым, повтор к тому же
  // поставщику уйдёт с НОВЫМ request_id и заглушка заминтит второй код: именно эту подпись
  // дефекта и ловят проверки ниже (одна строка попытки, attempt_no=1, одна выдача у A)
  it('replays the same request_id after a garbage-body 5xx instead of minting a second code', async () => {
    await forceScenario(stubA, 'error_5xx_garbage', 1);

    const extId = await createOrder(SUPPLIER_SKU);

    await payOrder(extId, SUPPLIER_SKU_AMOUNT_MAJOR, 'evt_worker_supplier_garbage_5xx');

    const job = await pollJobUntil(
      api.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
    );

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERED);

    const attempts = await fetchDeliveryAttempts(extId);

    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      supplier_code: SUPPLIER_CODE.A,
      attempt_no: 1,
      state: ATTEMPT_STATE.SUCCEEDED,
    });

    const issued = await fetchIssuedDeliveries(extId);

    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ source: DELIVERY_SOURCE.SUPPLIER, supplier_code: SUPPLIER_CODE.A });

    // главное: у самой заглушки A заминчен ровно один код на этот заказ
    const stateA = await getJson<IStubControlState>(stubA.baseUrl, '/_control/state');

    expect(stateA.body.issuedCount).toBe(1);

    // первая claim ловит неопределённый 5xx (unknown, retry_required), вторая реплеит тот же
    // request_id и получает код от того же поставщика
    expect(job.attempts).toBe(2);
    expect(job.last_error).toBeNull();
  });

  it('moves the order to out_of_stock when both suppliers report out_of_stock within a single job claim', async () => {
    await forceScenario(stubA, 'out_of_stock', 1);
    await forceScenario(stubB, 'out_of_stock', 1);

    const extId = await createOrder(SUPPLIER_SKU);

    await payOrder(extId, SUPPLIER_SKU_AMOUNT_MAJOR, 'evt_worker_supplier_out_of_stock');

    const job = await pollJobUntil(
      api.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
    );

    // out_of_stock — определённый (не сетевой) исход: оба поставщика перебираются
    // без выхода за пределы одной claim джобы (нет throw, только внутренний continue)
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBeNull();

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.OUT_OF_STOCK);

    const attempts = await fetchDeliveryAttempts(extId);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, state: ATTEMPT_STATE.FAILED });
    expect(attempts[1]).toMatchObject({ supplier_code: SUPPLIER_CODE.B, attempt_no: 1, state: ATTEMPT_STATE.FAILED });

    expect(await fetchIssuedDeliveries(extId)).toHaveLength(0);
  });

  it('finalizes delivery_failed when both suppliers exhaust the http_5xx retry budget within a single job claim', async () => {
    await forceScenario(stubA, 'error_5xx', 2);
    await forceScenario(stubB, 'error_5xx', 2);

    const extId = await createOrder(SUPPLIER_SKU);

    await payOrder(extId, SUPPLIER_SKU_AMOUNT_MAJOR, 'evt_worker_supplier_delivery_failed');

    const job = await pollJobUntil(
      api.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
    );

    // http_5xx повторяет того же поставщика через встроенный sleep() внутри одного прогона
    // fulfil() (см. settleStep) — бюджет SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER=2 исчерпывается на
    // обоих поставщиках без выхода за пределы одной claim джобы (нет throw, только continue),
    // после чего pickSupplier возвращает null и finalizeExhausted завершает заказ delivery_failed
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBeNull();

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERY_FAILED);

    const attempts = await fetchDeliveryAttempts(extId);

    expect(attempts).toHaveLength(4);
    expect(attempts[0]).toMatchObject({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, state: ATTEMPT_STATE.FAILED });
    expect(attempts[1]).toMatchObject({ supplier_code: SUPPLIER_CODE.A, attempt_no: 2, state: ATTEMPT_STATE.FAILED });
    expect(attempts[2]).toMatchObject({ supplier_code: SUPPLIER_CODE.B, attempt_no: 1, state: ATTEMPT_STATE.FAILED });
    expect(attempts[3]).toMatchObject({ supplier_code: SUPPLIER_CODE.B, attempt_no: 2, state: ATTEMPT_STATE.FAILED });

    expect(await fetchIssuedDeliveries(extId)).toHaveLength(0);
  });

  // регрессия C1 и критерий 6 задания: после исчерпания обоих поставщиков новое поколение выдачи
  // обязано снова позвонить поставщику — план фолбэка считается в границах одного поколения
  it('calls a supplier again in the next delivery generation after both reported out_of_stock', async () => {
    await forceScenario(stubA, 'out_of_stock', 1);
    await forceScenario(stubB, 'out_of_stock', 1);

    const extId = await createOrder(SUPPLIER_SKU);

    await payOrder(extId, SUPPLIER_SKU_AMOUNT_MAJOR, 'evt_worker_supplier_next_generation');

    const dedupeKey = buildDeliverOrderDedupeKey(extId);

    await pollJobsUntil(api.dataSource, dedupeKey, (rows) => rows.length === 1 && rows[0].state === JOB_STATE.DONE);

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.OUT_OF_STOCK);

    const { status, body } = await post<RedeliverResponseDto>(
      api.baseUrl,
      `/admin/orders/${extId}/redeliver`,
      { reason: 'manual retry after restock' },
      { [ADMIN_TOKEN_HEADER]: TEST_ADMIN_TOKEN },
    );

    expect(status).toBe(202);
    expect(body).toEqual({ enqueued: true, generation: 1 });

    const jobs = await pollJobsUntil(
      api.dataSource,
      dedupeKey,
      (rows) => rows.length === 2 && rows[1].state === JOB_STATE.DONE,
    );

    expect(jobs[1].last_error).toBeNull();

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERED);

    const attempts = await fetchDeliveryAttempts(extId);

    // attempt_no снова 1 у поставщика A в поколении 1 — это и есть переформованный
    // delivery_attempts_slot_uq (order_id, delivery_generation, supplier_code, attempt_no)
    expect(attempts).toHaveLength(3);
    expect(attempts[0]).toMatchObject({
      delivery_generation: 0,
      supplier_code: SUPPLIER_CODE.A,
      attempt_no: 1,
      state: ATTEMPT_STATE.FAILED,
    });
    expect(attempts[1]).toMatchObject({
      delivery_generation: 0,
      supplier_code: SUPPLIER_CODE.B,
      attempt_no: 1,
      state: ATTEMPT_STATE.FAILED,
    });
    expect(attempts[2]).toMatchObject({
      delivery_generation: 1,
      supplier_code: SUPPLIER_CODE.A,
      attempt_no: 1,
      state: ATTEMPT_STATE.SUCCEEDED,
    });

    const issued = await fetchIssuedDeliveries(extId);

    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ source: DELIVERY_SOURCE.SUPPLIER, supplier_code: SUPPLIER_CODE.A });
  });
});
