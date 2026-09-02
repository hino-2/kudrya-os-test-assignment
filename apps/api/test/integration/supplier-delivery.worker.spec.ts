import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

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
import { TEST_WORKER_SUPPLIER_A_PORT, TEST_WORKER_SUPPLIER_B_PORT } from '../helpers/harness.constants';
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
}

interface IIssuedDeliveryRow {
  source: string;
  supplier_code: string | null;
}

// товар в режиме fulfillment_mode='supplier' — единственный такой SKU в сидере (см. seed.helper)
const SUPPLIER_SKU = 'STEAM-TOPUP-500';

const SUPPLIER_SKU_AMOUNT_MAJOR = 500;

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

const SELECT_ORDER_STATUS_BY_EXT_ID_SQL = 'SELECT status FROM orders WHERE ext_id = $1';

const SELECT_DELIVERY_ATTEMPTS_SQL = `
  SELECT da.supplier_code, da.attempt_no, da.state
  FROM delivery_attempts da
  JOIN orders o ON o.id = da.order_id
  WHERE o.ext_id = $1
  ORDER BY da.id
`;

const SELECT_ISSUED_DELIVERIES_SQL = `
  SELECT id.source, id.supplier_code
  FROM issued_deliveries id
  JOIN orders o ON o.id = id.order_id
  WHERE o.ext_id = $1
`;

const POLL_STEP_MS = 25;

const POLL_TIMEOUT_MS = 5000;

let api: IApiHarness;

let stubA: IStubHarness;

let stubB: IStubHarness;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// поллинг вместо фиксированного sleep: тик реального @Interval не гарантирован на первой попытке
async function pollJobUntil(
  dataSource: DataSource,
  dedupeKey: string,
  predicate: (job: IJobRow) => boolean,
): Promise<IJobRow> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const rows = await dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const job = rows[0];

    if (job !== undefined && predicate(job)) {
      return job;
    }

    await delay(POLL_STEP_MS);
  }

  throw new Error(`Задача ${dedupeKey} не перешла в ожидаемое состояние за ${POLL_TIMEOUT_MS}мс`);
}

async function post<T>(baseUrl: string, path: string, payload: unknown): Promise<IHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
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
});
