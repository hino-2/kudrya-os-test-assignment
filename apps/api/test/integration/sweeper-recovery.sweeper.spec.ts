import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { UnitOfWorkService } from '../../src/common/db/unit-of-work.service';
import { ATTEMPT_STATE } from '../../src/delivery/delivery.constants';
import { JOB_KIND, JOB_STATE } from '../../src/jobs/jobs.constants';
import type { IEnqueueJobInput, IJobRow } from '../../src/jobs/jobs.interfaces';
import { JobQueueService } from '../../src/jobs/job-queue.service';
import { buildDeliverOrderDedupeKey } from '../../src/jobs/jobs.util';
import { ORDER_STATUS } from '../../src/orders/orders.constants';
import { PAYMENT_EVENT_STATE } from '../../src/payments/payments.constants';
import { SWEEPER_INFLIGHT_DEMOTED_REASON } from '../../src/reconciliation/sweeper.constants';
import { SweeperService } from '../../src/reconciliation/sweeper.service';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';

// не персистентные типы модуля — только для чтения сырых SELECT * в этом файле
interface IOrderRow {
  id: number;
  ext_id: string;
  status: string;
  delivery_generation: number;
}

interface IDeliveryAttemptRow {
  id: number;
  order_id: number;
  state: string;
  error_kind: string | null;
  error_reason: string | null;
}

interface IPaymentEventRow {
  id: number;
  state: string;
  ignore_reason: string | null;
}

const MARK_STALE_RUNNING_SQL = `
  UPDATE jobs
  SET state = 'running', locked_at = now() - ($2 || ' milliseconds')::interval, locked_by = 'dead-worker'
  WHERE dedupe_key = $1
`;

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

const INSERT_POOL_PRODUCT_SQL = `
  INSERT INTO products (sku, name, type, price_minor, currency, fulfillment_mode, is_active, in_stock)
  VALUES ($1, 'Sweeper test key', 'key', 1000, 'RUB', 'pool', TRUE, TRUE)
  RETURNING id
`;

const INSERT_SUPPLIER_PRODUCT_SQL = `
  INSERT INTO products (sku, name, type, price_minor, currency, fulfillment_mode, is_active, in_stock)
  VALUES ($1, 'Sweeper test topup', 'topup', 1000, 'RUB', 'supplier', TRUE, TRUE)
  RETURNING id
`;

const INSERT_SKU_STOCK_SQL = 'INSERT INTO sku_stock (product_id, available_count) VALUES ($1, $2)';

const SET_AVAILABLE_COUNT_SQL = 'UPDATE sku_stock SET available_count = $2, updated_at = now() WHERE product_id = $1';

const INSERT_ORDER_SQL = `
  INSERT INTO orders (ext_id, product_id, sku, unit_price_minor, total_minor, currency, status,
                      delivery_generation, paid_at, updated_at)
  VALUES ($1, $2, $3, 1000, 1000, 'RUB', $4, $5, $6, now() - ($7 || ' seconds')::interval)
  RETURNING id, ext_id
`;

const SELECT_ORDER_BY_EXT_ID_SQL = 'SELECT * FROM orders WHERE ext_id = $1';

const INSERT_DELIVERY_ATTEMPT_SQL = `
  INSERT INTO delivery_attempts (order_id, supplier_code, attempt_no, request_id, sku, state, started_at, next_resolve_at)
  VALUES ($1, 'A', 1, $2, 'SWEEPER-SKU', $3, $4, $5)
  RETURNING id
`;

const SELECT_DELIVERY_ATTEMPT_SQL = 'SELECT * FROM delivery_attempts WHERE id = $1';

const INSERT_ORPHAN_EVENT_SQL = `
  INSERT INTO payment_events (event_id, order_ext_id, status, amount_minor, currency, occurred_at,
                              raw_payload, state, received_at)
  VALUES ($1, $2, 'paid', $3, 'RUB', now(), '{}'::jsonb, 'orphan', now() - ($4 || ' seconds')::interval)
  RETURNING id
`;

const SELECT_PAYMENT_EVENT_SQL = 'SELECT * FROM payment_events WHERE event_id = $1';

let harness: IApiHarness;
let nextSuffix = 0;

function uniqueId(): string {
  nextSuffix += 1;

  return `${Date.now()}-${nextSuffix}`;
}

function buildEnqueueInput(overrides: Partial<IEnqueueJobInput>): IEnqueueJobInput {
  return {
    kind: JOB_KIND.DELIVER_ORDER,
    dedupeKey: `sweeper-spec:${uniqueId()}`,
    payload: { orderId: 1, ext_id: 'ord_1', generation: 1 },
    runAt: new Date(),
    traceId: null,
    ...overrides,
  };
}

async function enqueue(overrides: Partial<IEnqueueJobInput>): Promise<number | null> {
  const unitOfWork = harness.get(UnitOfWorkService);
  const queue = harness.get(JobQueueService);
  const input = buildEnqueueInput(overrides);

  return unitOfWork.withTransaction((qr) => queue.enqueue(qr, input));
}

async function insertPoolProduct(): Promise<number> {
  const rows = await harness.dataSource.query<Array<{ id: number }>>(INSERT_POOL_PRODUCT_SQL, [`SW-POOL-${uniqueId()}`]);

  return rows[0].id;
}

async function insertSupplierProduct(availableCount: number): Promise<number> {
  const rows = await harness.dataSource.query<Array<{ id: number }>>(INSERT_SUPPLIER_PRODUCT_SQL, [
    `SW-SUP-${uniqueId()}`,
  ]);
  const productId = rows[0].id;

  await harness.dataSource.query(INSERT_SKU_STOCK_SQL, [productId, availableCount]);

  return productId;
}

interface IInsertOrderOptions {
  productId: number;
  status: string;
  deliveryGeneration?: number;
  paidAt?: Date | null;
  updatedAtAgeSeconds?: number;
}

async function insertOrder(options: IInsertOrderOptions): Promise<IOrderRow> {
  const extId = `ord_sweeper_${uniqueId()}`;
  const rows = await harness.dataSource.query<Array<{ id: number; ext_id: string }>>(INSERT_ORDER_SQL, [
    extId,
    options.productId,
    `SW-${uniqueId()}`,
    options.status,
    options.deliveryGeneration ?? 0,
    options.paidAt ?? null,
    options.updatedAtAgeSeconds ?? 0,
  ]);

  return fetchOrder(rows[0].ext_id);
}

async function fetchOrder(extId: string): Promise<IOrderRow> {
  const rows = await harness.dataSource.query<IOrderRow[]>(SELECT_ORDER_BY_EXT_ID_SQL, [extId]);

  return rows[0];
}

async function fetchJobByDedupeKey(dedupeKey: string): Promise<IJobRow | undefined> {
  const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);

  return rows[0];
}

async function fetchJobsByDedupeKey(dedupeKey: string): Promise<IJobRow[]> {
  return harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
}

interface IInsertAttemptOptions {
  orderId: number;
  state: string;
  startedAt?: Date | null;
  nextResolveAt?: Date | null;
}

async function insertAttempt(options: IInsertAttemptOptions): Promise<number> {
  const rows = await harness.dataSource.query<Array<{ id: number }>>(INSERT_DELIVERY_ATTEMPT_SQL, [
    options.orderId,
    `req-${uniqueId()}`,
    options.state,
    options.startedAt ?? null,
    options.nextResolveAt ?? null,
  ]);

  return rows[0].id;
}

async function fetchAttempt(id: number): Promise<IDeliveryAttemptRow> {
  const rows = await harness.dataSource.query<IDeliveryAttemptRow[]>(SELECT_DELIVERY_ATTEMPT_SQL, [id]);

  return rows[0];
}

async function insertOrphanEvent(orderExtId: string, ageSeconds: number, amountMinor = 1000): Promise<string> {
  const eventId = `evt-${uniqueId()}`;

  await harness.dataSource.query(INSERT_ORPHAN_EVENT_SQL, [eventId, orderExtId, amountMinor, ageSeconds]);

  return eventId;
}

async function fetchPaymentEvent(eventId: string): Promise<IPaymentEventRow> {
  const rows = await harness.dataSource.query<IPaymentEventRow[]>(SELECT_PAYMENT_EVENT_SQL, [eventId]);

  return rows[0];
}

beforeAll(async () => {
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.dataSource);
});

describe('sweeper (recovery passes)', () => {
  it('pass 1: reclaims a job stuck in running past the lock TTL', async () => {
    const sweeper = harness.get(SweeperService);
    const dedupeKey = `sweeper-pass1:${uniqueId()}`;

    await enqueue({ dedupeKey });
    await harness.dataSource.query(MARK_STALE_RUNNING_SQL, [dedupeKey, 2000]);

    const result = await sweeper.runOnce();

    expect(result.reclaimedStaleJobs).toBe(1);

    const job = await fetchJobByDedupeKey(dedupeKey);

    expect(job?.state).toBe(JOB_STATE.PENDING);
    expect(job?.locked_at).toBeNull();
  });

  it('pass 2: requeues a stuck paid order with no issued delivery and no live job', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertPoolProduct();
    const order = await insertOrder({
      productId,
      status: ORDER_STATUS.PAID,
      paidAt: new Date(),
      updatedAtAgeSeconds: 2,
    });

    const result = await sweeper.runOnce();

    expect(result.requeuedStuckOrders).toBe(1);

    const job = await fetchJobByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(job).toBeDefined();
    expect(job?.state).toBe(JOB_STATE.PENDING);

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.PAID);
    expect(updatedOrder.delivery_generation).toBe(0);
  });

  it('pass 2: leaves a freshly updated paid order alone', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertPoolProduct();
    const order = await insertOrder({ productId, status: ORDER_STATUS.PAID, paidAt: new Date(), updatedAtAgeSeconds: 0 });

    const result = await sweeper.runOnce();

    expect(result.requeuedStuckOrders).toBe(0);

    const job = await fetchJobByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(job).toBeUndefined();
  });

  it('pass 3: retries an out_of_stock order once its product is restocked', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(0);
    const order = await insertOrder({
      productId,
      status: ORDER_STATUS.OUT_OF_STOCK,
      deliveryGeneration: 1,
      paidAt: new Date(),
    });

    await harness.dataSource.query(SET_AVAILABLE_COUNT_SQL, [productId, 5]);

    const result = await sweeper.runOnce();

    expect(result.retriedOutOfStock).toBe(1);

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.DELIVERING);
    expect(updatedOrder.delivery_generation).toBe(2);

    const job = await fetchJobByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(job).toBeDefined();
  });

  it('pass 3: leaves an out_of_stock order alone while its product has no stock', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(0);
    const order = await insertOrder({ productId, status: ORDER_STATUS.OUT_OF_STOCK, paidAt: new Date() });

    const result = await sweeper.runOnce();

    expect(result.retriedOutOfStock).toBe(0);

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.OUT_OF_STOCK);
  });

  it('pass 4: retries a delivery_failed order past the retry window under the generation cap', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(5);
    const order = await insertOrder({
      productId,
      status: ORDER_STATUS.DELIVERY_FAILED,
      deliveryGeneration: 1,
      paidAt: new Date(),
      updatedAtAgeSeconds: 2,
    });

    const result = await sweeper.runOnce();

    expect(result.retriedDeliveryFailed).toBe(1);

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.DELIVERING);
    expect(updatedOrder.delivery_generation).toBe(2);
  });

  it('pass 4: does not retry a delivery_failed order at the generation cap', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(5);
    const order = await insertOrder({
      productId,
      status: ORDER_STATUS.DELIVERY_FAILED,
      deliveryGeneration: 3,
      paidAt: new Date(),
      updatedAtAgeSeconds: 2,
    });

    const result = await sweeper.runOnce();

    expect(result.retriedDeliveryFailed).toBe(0);

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.DELIVERY_FAILED);
  });

  it('pass 5a/5b: demotes a stale in_flight attempt to unknown and immediately redrives it', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(5);
    const order = await insertOrder({ productId, status: ORDER_STATUS.DELIVERING, paidAt: new Date() });
    const attemptId = await insertAttempt({
      orderId: order.id,
      state: ATTEMPT_STATE.IN_FLIGHT,
      startedAt: new Date(Date.now() - 5000),
    });

    const result = await sweeper.runOnce();

    expect(result.demotedStaleInflight).toBe(1);
    expect(result.redrivenUnknownAttempts).toBe(1);

    const attempt = await fetchAttempt(attemptId);

    expect(attempt.state).toBe(ATTEMPT_STATE.UNKNOWN);
    expect(attempt.error_kind).toBe('inflight_expired');
    expect(attempt.error_reason).toBe(SWEEPER_INFLIGHT_DEMOTED_REASON);

    const job = await fetchJobByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(job).toBeDefined();
  });

  it('pass 5b: redrives an already-unknown attempt whose resolve time has arrived', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(5);
    const order = await insertOrder({ productId, status: ORDER_STATUS.DELIVERING, paidAt: new Date() });

    await insertAttempt({
      orderId: order.id,
      state: ATTEMPT_STATE.UNKNOWN,
      nextResolveAt: new Date(Date.now() - 1000),
    });

    const result = await sweeper.runOnce();

    expect(result.demotedStaleInflight).toBe(0);
    expect(result.redrivenUnknownAttempts).toBe(1);

    const job = await fetchJobByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(job).toBeDefined();
  });

  it('pass 5a: leaves a fresh in_flight attempt alone', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(5);
    const order = await insertOrder({ productId, status: ORDER_STATUS.DELIVERING, paidAt: new Date() });
    const attemptId = await insertAttempt({ orderId: order.id, state: ATTEMPT_STATE.IN_FLIGHT, startedAt: new Date() });

    const result = await sweeper.runOnce();

    expect(result.demotedStaleInflight).toBe(0);

    const attempt = await fetchAttempt(attemptId);

    expect(attempt.state).toBe(ATTEMPT_STATE.IN_FLIGHT);
  });

  it('pass 6a: replays an orphan payment event once its order has appeared', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertPoolProduct();
    const order = await insertOrder({ productId, status: ORDER_STATUS.CREATED, paidAt: null });
    const eventId = await insertOrphanEvent(order.ext_id, 0);

    const result = await sweeper.runOnce();

    expect(result.replayedOrphans).toBe(1);

    const event = await fetchPaymentEvent(eventId);

    expect(event.state).toBe(PAYMENT_EVENT_STATE.APPLIED);

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.PAID);

    const job = await fetchJobByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(job).toBeDefined();
  });

  it('pass 6b: abandons an orphan payment event past the TTL with no matching order', async () => {
    const sweeper = harness.get(SweeperService);
    const eventId = await insertOrphanEvent('ord_never_existed', 2);

    const result = await sweeper.runOnce();

    expect(result.abandonedOrphans).toBe(1);

    const event = await fetchPaymentEvent(eventId);

    expect(event.state).toBe(PAYMENT_EVENT_STATE.ABANDONED);
    expect(event.ignore_reason).toBe('sweeper: orphan ttl exceeded, order never appeared');
  });

  it('pass 6b: leaves a fresh orphan payment event alone', async () => {
    const sweeper = harness.get(SweeperService);
    const eventId = await insertOrphanEvent('ord_never_existed_2', 0);

    const result = await sweeper.runOnce();

    expect(result.abandonedOrphans).toBe(0);

    const event = await fetchPaymentEvent(eventId);

    expect(event.state).toBe(PAYMENT_EVENT_STATE.ORPHAN);
  });
});

describe('sweeper (concurrency safety)', () => {
  it('two concurrent runOnce() calls never double-enqueue delivery for the same stuck order', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertPoolProduct();
    const order = await insertOrder({
      productId,
      status: ORDER_STATUS.PAID,
      paidAt: new Date(),
      updatedAtAgeSeconds: 2,
    });

    // findStuckPaidDelivering не берёт блокировку строки (в отличие от findRetryableOutOfStock)
    // — единственная защита от двойной постановки в очередь здесь: ON CONFLICT (kind, dedupe_key)
    // DO NOTHING в jobs (JOB_ENQUEUE_SQL), а не блокировка на уровне приложения
    await Promise.all([sweeper.runOnce(), sweeper.runOnce()]);

    const jobs = await fetchJobsByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(jobs).toHaveLength(1);
  });

  it('two concurrent runOnce() calls never double-enqueue retry for the same out_of_stock order', async () => {
    const sweeper = harness.get(SweeperService);
    const productId = await insertSupplierProduct(5);
    const order = await insertOrder({
      productId,
      status: ORDER_STATUS.OUT_OF_STOCK,
      deliveryGeneration: 1,
      paidAt: new Date(),
    });

    // findRetryableOutOfStock блокирует строку заказа (FOR UPDATE OF o SKIP LOCKED) и transition
    // — это CAS-UPDATE (WHERE status = from) поверх неё; вместе они не дают второму runOnce()
    // повторно перевести тот же заказ в delivering
    await Promise.all([sweeper.runOnce(), sweeper.runOnce()]);

    const jobs = await fetchJobsByDedupeKey(buildDeliverOrderDedupeKey(order.ext_id));

    expect(jobs).toHaveLength(1);

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.DELIVERING);
    expect(updatedOrder.delivery_generation).toBe(2);
  });
});
