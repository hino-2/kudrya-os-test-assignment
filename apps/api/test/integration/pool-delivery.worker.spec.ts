import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { JOB_STATE } from '../../src/jobs/jobs.constants';
import { buildDeliverOrderDedupeKey } from '../../src/jobs/jobs.util';
import type { IJobRow } from '../../src/jobs/jobs.interfaces';
import { ORDER_STATUS } from '../../src/orders/orders.constants';
import type { CreateOrderResponseDto } from '../../src/orders/dto/create-order.response.dto';
import type { PaymentWebhookResponseDto } from '../../src/payments/dto/payment-webhook.response.dto';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';
import { seedCatalog } from '../helpers/seed.helper';

interface IHttpResult<T> {
  status: number;
  body: T;
}

interface IOrderRow {
  status: string;
}

const POOL_SKU = 'KEY-CS2-PRIME';

const POOL_SKU_AMOUNT_MAJOR = 1290;

const DRAIN_SKU = 'KEY-EFT';

const DRAIN_SKU_AMOUNT_MAJOR = 3490;

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

const SELECT_ORDER_STATUS_BY_EXT_ID_SQL = 'SELECT status FROM orders WHERE ext_id = $1';

const DELETE_STOCK_KEYS_FOR_SKU_SQL = `
  DELETE FROM stock_keys WHERE product_id = (SELECT id FROM products WHERE sku = $1)
`;

const POLL_STEP_MS = 25;

const POLL_TIMEOUT_MS = 5000;

let harness: IApiHarness;

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

async function post<T>(path: string, payload: unknown): Promise<IHttpResult<T>> {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

async function createOrder(sku: string): Promise<string> {
  const { body } = await post<CreateOrderResponseDto>('/orders', { sku });

  return body.order_id;
}

async function payOrder(extId: string, amountMajor: number, eventId: string): Promise<void> {
  const { body } = await post<PaymentWebhookResponseDto>('/webhooks/payment', {
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
  const rows = await harness.dataSource.query<IOrderRow[]>(SELECT_ORDER_STATUS_BY_EXT_ID_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row.status;
}

async function drainAllKeys(sku: string): Promise<void> {
  await harness.dataSource.query(DELETE_STOCK_KEYS_FOR_SKU_SQL, [sku]);
}

beforeAll(async () => {
  // WORKER_ENABLED=true форсирован в env.setup.worker-enabled.ts (setupFiles проекта
  // integration-worker) — envOverrides здесь не нужен и не сработал бы (см. комментарий в setup-файле)
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.dataSource);
  await seedCatalog(harness.dataSource);
});

describe('pool delivery via the real scheduled job worker (WORKER_ENABLED=true)', () => {
  it('delivers a pool key through the enqueued deliver_order job and marks it done', async () => {
    const extId = await createOrder(POOL_SKU);

    await payOrder(extId, POOL_SKU_AMOUNT_MAJOR, 'evt_worker_pool_happy');

    const job = await pollJobUntil(
      harness.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
    );

    expect(job.attempts).toBe(1);
    expect(job.last_error).toBeNull();
    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERED);
  });

  it('completes the job as done and moves the order to out_of_stock when the pool is drained', async () => {
    const extId = await createOrder(DRAIN_SKU);

    await drainAllKeys(DRAIN_SKU);
    await payOrder(extId, DRAIN_SKU_AMOUNT_MAJOR, 'evt_worker_pool_drained');

    const job = await pollJobUntil(
      harness.dataSource,
      buildDeliverOrderDedupeKey(extId),
      (row) => row.state === JOB_STATE.DONE,
    );

    expect(job.attempts).toBe(1);
    expect(job.last_error).toBeNull();
    expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.OUT_OF_STOCK);
  });
});
