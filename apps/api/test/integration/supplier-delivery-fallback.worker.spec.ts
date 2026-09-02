import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { JOB_STATE } from '../../src/jobs/jobs.constants';
import { buildDeliverOrderDedupeKey } from '../../src/jobs/jobs.util';
import type { IJobRow } from '../../src/jobs/jobs.interfaces';
import { ORDER_STATUS } from '../../src/orders/orders.constants';
import type { CreateOrderResponseDto } from '../../src/orders/dto/create-order.response.dto';
import type { PaymentWebhookResponseDto } from '../../src/payments/dto/payment-webhook.response.dto';
import { ATTEMPT_STATE, DELIVERY_SOURCE } from '../../src/delivery/delivery.constants';
import { SUPPLIER_CODE, SUPPLIER_ERROR_KIND } from '../../src/suppliers/suppliers.constants';
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
  error_kind: string | null;
  request_id: string;
}

interface IIssuedDeliveryRow {
  source: string;
  supplier_code: string | null;
}

const SUPPLIER_SKU = 'STEAM-TOPUP-500';

const SUPPLIER_SKU_AMOUNT_MAJOR = 500;

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

const SELECT_ORDER_STATUS_BY_EXT_ID_SQL = 'SELECT status FROM orders WHERE ext_id = $1';

const SELECT_DELIVERY_ATTEMPTS_SQL = `
  SELECT da.supplier_code, da.attempt_no, da.state, da.error_kind, da.request_id
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

let stubB: IStubHarness;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  // одноразовый инстанс A на ФИКСИРОВАННОМ порту стартует и сразу останавливается: последующие
  // обращения к этому (уже свободному) порту получают настоящий ECONNREFUSED от ОС, а не наш
  // REFUSE-сценарий заглушки (тот даёт ECONNRESET — другой, не тестируемый здесь код классификации).
  // Порт обязан быть тем же, что зашит в SUPPLIER_A_BASE_URL в env.setup.worker-enabled.ts
  // (см. комментарий там же и в harness.constants.ts) — иначе API будет стучаться в другой адрес.
  const deadStubA = await startStub(
    {
      STUB_FAIL_RATE: '0',
      STUB_TIMEOUT_RATE: '0',
      STUB_SLOW_RATE: '0',
      STUB_PERSIST_PATH: '',
      SUPPLIER_ID: 'A',
    },
    TEST_WORKER_SUPPLIER_A_PORT,
  );

  await deadStubA.stop();

  stubB = await startStub(
    {
      STUB_FAIL_RATE: '0',
      STUB_TIMEOUT_RATE: '0',
      STUB_SLOW_RATE: '0',
      STUB_PERSIST_PATH: '',
      SUPPLIER_ID: 'B',
    },
    TEST_WORKER_SUPPLIER_B_PORT,
  );

  // WORKER_ENABLED=true, SUPPLIER_A_BASE_URL/SUPPLIER_B_BASE_URL и SUPPLIER_REQUEST_TIMEOUT_MS
  // форсированы в env.setup.worker-enabled.ts (setupFiles проекта integration-worker) ДО импорта
  // AppModule — envOverrides в startApi() здесь не сработал бы (см. комментарий в setup-файле)
  api = await startApi();
});

afterAll(async () => {
  await api?.stop();
  await stubB?.stop();
});

beforeEach(async () => {
  await resetDatabase(api.dataSource);
  await seedCatalog(api.dataSource);
});

describe('supplier delivery falls back A -> B when A is unreachable (WORKER_ENABLED=true)', () => {
  it('falls back to supplier B within a single job claim after a definitive connection_refused from A', async () => {
    const extId = await createOrder(SUPPLIER_SKU);

    await payOrder(extId, SUPPLIER_SKU_AMOUNT_MAJOR, 'evt_worker_supplier_fallback');

    const job = await pollJobUntil(
      api.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
    );

    // connection_refused — определённая неудача (не unknown): фолбэк на B без выхода за
    // пределы одной claim джобы
    expect(job.attempts).toBe(1);
    expect(job.last_error).toBeNull();

    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERED);

    const attempts = await fetchDeliveryAttempts(extId);

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({
      supplier_code: SUPPLIER_CODE.A,
      attempt_no: 1,
      state: ATTEMPT_STATE.FAILED,
      error_kind: SUPPLIER_ERROR_KIND.CONNECTION_REFUSED,
    });
    expect(attempts[1]).toMatchObject({
      supplier_code: SUPPLIER_CODE.B,
      attempt_no: 1,
      state: ATTEMPT_STATE.SUCCEEDED,
    });
    // разные request_id между A и B: buildSupplierRequestId включает supplierCode+attemptNo
    expect(attempts[0].request_id).not.toBe(attempts[1].request_id);

    const issued = await fetchIssuedDeliveries(extId);

    expect(issued).toHaveLength(1);
    expect(issued[0]).toMatchObject({ source: DELIVERY_SOURCE.SUPPLIER, supplier_code: SUPPLIER_CODE.B });
  });
});
