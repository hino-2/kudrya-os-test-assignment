import type { QueryRunner } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IErrorEnvelope } from '../../src/common/errors/errors.interfaces';
import { ORDER_TRANSITION_SQL } from '../../src/orders/orders.constants';
import type { IOrderRow } from '../../src/orders/orders.interfaces';
import { OrdersRepository } from '../../src/orders/orders.repository';
import type { CreateOrderResponseDto } from '../../src/orders/dto/create-order.response.dto';
import type { OrderResponseDto } from '../../src/orders/dto/order.response.dto';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';
import { seedCatalog } from '../helpers/seed.helper';

interface IHttpResult<T> {
  status: number;
  body: T;
}

interface ICountRow {
  count: number;
}

interface IAvailableRow {
  available_count: number;
}

const TOPUP_SKU = 'STEAM-TOPUP-500';

const POOL_SKU = 'KEY-GTA5';

const FIRST_EXT_ID = 'ord_00100';

const SECOND_EXT_ID = 'ord_00101';

const LOCK_PROBE_MS = 150;

const PENDING = Symbol('pending');

const COUNT_ORDERS_BY_EXT_SQL = 'SELECT count(*)::int AS count FROM orders WHERE ext_id = $1';

const COUNT_ORDERS_SQL = 'SELECT count(*)::int AS count FROM orders';

const COUNT_JOBS_SQL = 'SELECT count(*)::int AS count FROM jobs';

const COUNT_LEDGER_TXNS_SQL = 'SELECT count(*)::int AS count FROM ledger_txns';

const COUNT_LEDGER_ENTRIES_SQL = 'SELECT count(*)::int AS count FROM ledger_entries';

const COUNT_PAYMENT_EVENTS_SQL = 'SELECT count(*)::int AS count FROM payment_events';

const COUNT_ISSUED_DELIVERIES_SQL = 'SELECT count(*)::int AS count FROM issued_deliveries';

const COUNT_LINKED_KEYS_SQL =
  'SELECT count(*)::int AS count FROM stock_keys WHERE order_id IS NOT NULL';

const SELECT_ORDER_SQL = 'SELECT * FROM orders WHERE ext_id = $1';

const SELECT_AVAILABLE_SQL = `
  SELECT s.available_count
  FROM sku_stock s
  JOIN products p ON p.id = s.product_id
  WHERE p.sku = $1
`;

const DEACTIVATE_PRODUCT_SQL = 'UPDATE products SET is_active = FALSE WHERE sku = $1';

const DRAIN_STOCK_SQL = `
  UPDATE sku_stock s SET available_count = 0
  FROM products p WHERE p.id = s.product_id AND p.sku = $1
`;

const CLEAR_IN_STOCK_SQL = 'UPDATE products SET in_stock = FALSE WHERE sku = $1';

const SQUAT_EXT_ID_SQL = `
  INSERT INTO orders (ext_id, product_id, sku, quantity, unit_price_minor, total_minor, currency, buyer_email)
  SELECT $1, id, sku, 1, price_minor, price_minor, currency, $3
  FROM products
  WHERE sku = $2
`;

const FORCE_STATUS_SQL = 'UPDATE orders SET status = $2 WHERE ext_id = $1';

const FORCE_DELIVERED_SQL =
  "UPDATE orders SET status = 'delivered', delivered_at = now() WHERE ext_id = $1";

let harness: IApiHarness;

async function post<T>(path: string, payload: unknown): Promise<IHttpResult<T>> {
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

async function get<T>(path: string): Promise<IHttpResult<T>> {
  const response = await fetch(`${harness.baseUrl}${path}`);
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

async function scalarOf(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await harness.dataSource.query<ICountRow[]>(sql, params);
  const row = rows[0];

  if (row === undefined) {
    throw new Error('Запрос счётчика не вернул строку');
  }

  return row.count;
}

async function availableOf(sku: string): Promise<number> {
  const rows = await harness.dataSource.query<IAvailableRow[]>(SELECT_AVAILABLE_SQL, [sku]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Остаток по ${sku} не найден`);
  }

  return row.available_count;
}

async function storedOrder(extId: string): Promise<IOrderRow> {
  const rows = await harness.dataSource.query<IOrderRow[]>(SELECT_ORDER_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row;
}

function requireOrder(row: IOrderRow | null): IOrderRow {
  if (row === null) {
    throw new Error('Ожидалась строка заказа');
  }

  return row;
}

function delay(ms: number): Promise<typeof PENDING> {
  return new Promise((resolve) => setTimeout(() => resolve(PENDING), ms));
}

async function closeRunner(runner: QueryRunner): Promise<void> {
  if (runner.isTransactionActive) {
    await runner.rollbackTransaction();
  }

  await runner.release();
}

beforeAll(async () => {
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.dataSource);
  await seedCatalog(harness.dataSource);
});

describe('POST /orders', () => {
  it('creates an order and mints the first sequence id', async () => {
    const { status, body } = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });

    expect(status).toBe(201);
    expect(body).toEqual({
      order_id: FIRST_EXT_ID,
      status: 'created',
      sku: TOPUP_SKU,
      quantity: 1,
      amount_minor: 50000,
      amount: 500,
      currency: 'RUB',
      created_at: expect.any(String) as string,
    });
    expect(Number.isNaN(Date.parse(body.created_at))).toBe(false);
  });

  it('advances the sequence exactly once per created order', async () => {
    await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });

    const second = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });

    expect(second.status).toBe(201);
    expect(second.body.order_id).toBe(SECOND_EXT_ID);
  });

  it('replays the same client_order_id with 200 and a byte-identical body', async () => {
    const first = await post<CreateOrderResponseDto>('/orders', {
      sku: TOPUP_SKU,
      client_order_id: 'ord_idem_1',
    });

    expect(first.status).toBe(201);
    expect(first.body.order_id).toBe('ord_idem_1');

    const replay = await post<CreateOrderResponseDto>('/orders', {
      sku: TOPUP_SKU,
      client_order_id: 'ord_idem_1',
    });

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await scalarOf(COUNT_ORDERS_BY_EXT_SQL, ['ord_idem_1'])).toBe(1);
  });

  it('answers a replay with the stored order even when the payload differs', async () => {
    const first = await post<CreateOrderResponseDto>('/orders', {
      sku: TOPUP_SKU,
      client_order_id: 'ord_idem_2',
    });
    const replay = await post<CreateOrderResponseDto>('/orders', {
      sku: POOL_SKU,
      client_order_id: 'ord_idem_2',
      buyer_email: 'buyer@example.com',
    });

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);

    const stored = await storedOrder('ord_idem_2');

    expect(stored.sku).toBe(TOPUP_SKU);
    expect(stored.buyer_email).toBeNull();
    expect(await scalarOf(COUNT_ORDERS_SQL)).toBe(1);
  });

  it('answers a replay before validating the payload sku', async () => {
    const first = await post<CreateOrderResponseDto>('/orders', {
      sku: TOPUP_SKU,
      client_order_id: 'ord_idem_4',
    });
    const replay = await post<CreateOrderResponseDto>('/orders', {
      sku: 'NOPE',
      client_order_id: 'ord_idem_4',
    });

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
    expect(await scalarOf(COUNT_ORDERS_SQL)).toBe(1);
  });

  it('answers a replay of an order whose product went inactive', async () => {
    const first = await post<CreateOrderResponseDto>('/orders', {
      sku: POOL_SKU,
      client_order_id: 'ord_idem_5',
    });

    await harness.dataSource.query(DEACTIVATE_PRODUCT_SQL, [POOL_SKU]);

    const replay = await post<CreateOrderResponseDto>('/orders', {
      sku: POOL_SKU,
      client_order_id: 'ord_idem_5',
    });

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual(first.body);
  });

  it('never answers a minted id collision with the squatter order', async () => {
    await harness.dataSource.query(SQUAT_EXT_ID_SQL, [
      FIRST_EXT_ID,
      POOL_SKU,
      'squatter@example.com',
    ]);

    const { status, body } = await post<IErrorEnvelope>('/orders', { sku: TOPUP_SKU });

    expect(status).toBe(500);
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.details).toEqual({ order_id: FIRST_EXT_ID });
    expect(JSON.stringify(body)).not.toContain(POOL_SKU);

    const squatted = await storedOrder(FIRST_EXT_ID);

    expect(squatted.sku).toBe(POOL_SKU);
    expect(squatted.buyer_email).toBe('squatter@example.com');
    expect(await scalarOf(COUNT_ORDERS_SQL)).toBe(1);
  });

  it('never advances the sequence on a client-supplied id or its replay', async () => {
    await post<CreateOrderResponseDto>('/orders', {
      sku: TOPUP_SKU,
      client_order_id: 'ord_idem_3',
    });
    await post<CreateOrderResponseDto>('/orders', {
      sku: TOPUP_SKU,
      client_order_id: 'ord_idem_3',
    });

    const minted = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });

    expect(minted.body.order_id).toBe(FIRST_EXT_ID);
  });

  it('reports an unknown sku as 404 PRODUCT_NOT_FOUND', async () => {
    const { status, body } = await post<IErrorEnvelope>('/orders', { sku: 'NOPE' });

    expect(status).toBe(404);
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');
    expect(body.error.details).toEqual({ sku: 'NOPE' });
    expect(body.error.trace_id).toBeTruthy();
  });

  it('reports an inactive product as 409 PRODUCT_INACTIVE and creates nothing', async () => {
    await harness.dataSource.query(DEACTIVATE_PRODUCT_SQL, [POOL_SKU]);

    const { status, body } = await post<IErrorEnvelope>('/orders', { sku: POOL_SKU });

    expect(status).toBe(409);
    expect(body.error.code).toBe('PRODUCT_INACTIVE');
    expect(body.error.details).toEqual({ sku: POOL_SKU });
    expect(await scalarOf(COUNT_ORDERS_SQL)).toBe(0);
  });

  it.each([
    { name: 'missing sku', payload: {} },
    { name: 'sku with a space', payload: { sku: 'bad sku' } },
    { name: 'quantity other than one', payload: { sku: TOPUP_SKU, quantity: 2 } },
    {
      name: 'client_order_id without the ord_ prefix',
      payload: { sku: TOPUP_SKU, client_order_id: 'bad_1' },
    },
    {
      name: 'client_order_id inside the minted namespace',
      payload: { sku: TOPUP_SKU, client_order_id: FIRST_EXT_ID },
    },
    {
      name: 'client_order_id shadowing an unpadded minted id',
      payload: { sku: TOPUP_SKU, client_order_id: 'ord_7' },
    },
    { name: 'malformed buyer_email', payload: { sku: TOPUP_SKU, buyer_email: 'nope' } },
    { name: 'unknown property', payload: { sku: TOPUP_SKU, unknown: 1 } },
  ])('rejects $name with 400 VALIDATION_FAILED', async ({ payload }) => {
    const { status, body } = await post<IErrorEnvelope>('/orders', payload);

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(await scalarOf(COUNT_ORDERS_SQL)).toBe(0);
  });

  it('creates an order even when the sku is out of stock', async () => {
    await harness.dataSource.query(DRAIN_STOCK_SQL, [POOL_SKU]);
    await harness.dataSource.query(CLEAR_IN_STOCK_SQL, [POOL_SKU]);

    const { status, body } = await post<CreateOrderResponseDto>('/orders', { sku: POOL_SKU });

    expect(status).toBe(201);
    expect(body.status).toBe('created');
  });

  it('produces no side effect beyond the orders row', async () => {
    const availableBefore = await availableOf(TOPUP_SKU);

    await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });

    expect(await scalarOf(COUNT_ORDERS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_JOBS_SQL)).toBe(0);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(0);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(0);
    expect(await scalarOf(COUNT_PAYMENT_EVENTS_SQL)).toBe(0);
    expect(await scalarOf(COUNT_ISSUED_DELIVERIES_SQL)).toBe(0);
    expect(await scalarOf(COUNT_LINKED_KEYS_SQL)).toBe(0);
    expect(await availableOf(TOPUP_SKU)).toBe(availableBefore);
  });
});

describe('GET /orders/:orderId', () => {
  it('returns the full detail shape of a freshly created order', async () => {
    const created = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });
    const { status, body } = await get<OrderResponseDto>(`/orders/${created.body.order_id}`);

    expect(status).toBe(200);
    expect(body).toEqual({
      order_id: created.body.order_id,
      status: 'created',
      recoverable: false,
      terminal: false,
      sku: TOPUP_SKU,
      quantity: 1,
      amount_minor: created.body.amount_minor,
      amount: created.body.amount,
      currency: 'RUB',
      created_at: created.body.created_at,
      paid_at: null,
      delivered_at: null,
      failure_reason: null,
      delivery: null,
      payment_events: [],
      delivery_attempts: [],
    });
  });

  it('reports an unknown order as 404 ORDER_NOT_FOUND', async () => {
    const { status, body } = await get<IErrorEnvelope>('/orders/ord_99999');

    expect(status).toBe(404);
    expect(body.error.code).toBe('ORDER_NOT_FOUND');
    expect(body.error.details).toEqual({ order_id: 'ord_99999' });
  });

  it.each(['/orders/123', '/orders/bad%20id'])(
    'rejects %s with 400 VALIDATION_FAILED',
    async (path) => {
      const { status, body } = await get<IErrorEnvelope>(path);

      expect(status).toBe(400);
      expect(body.error.code).toBe('VALIDATION_FAILED');
    },
  );

  it('marks a recoverable status as recoverable and a terminal one as terminal', async () => {
    const created = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });
    const extId = created.body.order_id;

    await harness.dataSource.query(FORCE_STATUS_SQL, [extId, 'out_of_stock']);

    const recoverable = await get<OrderResponseDto>(`/orders/${extId}`);

    expect(recoverable.body.recoverable).toBe(true);
    expect(recoverable.body.terminal).toBe(false);

    await harness.dataSource.query(FORCE_DELIVERED_SQL, [extId]);

    const delivered = await get<OrderResponseDto>(`/orders/${extId}`);

    expect(delivered.body.recoverable).toBe(false);
    expect(delivered.body.terminal).toBe(true);
    expect(Number.isNaN(Date.parse(delivered.body.delivered_at ?? ''))).toBe(false);
  });
});

describe('OrdersRepository single-writer primitives', () => {
  it('applies a transition guarded by the current status', async () => {
    const repository = harness.get(OrdersRepository);
    const created = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });
    const before = await storedOrder(created.body.order_id);
    const paidAt = new Date();
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      const updated = requireOrder(
        await repository.transition(runner, before.id, 'created', 'paid', { paidAt }),
      );

      expect(updated.status).toBe('paid');
      expect(updated.paid_at).not.toBeNull();
      expect(updated.updated_at.getTime()).toBeGreaterThan(before.updated_at.getTime());
      await runner.commitTransaction();
    } finally {
      await closeRunner(runner);
    }
  });

  it('returns null and changes nothing when the CAS guard is stale', async () => {
    const repository = harness.get(OrdersRepository);
    const created = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });
    const before = await storedOrder(created.body.order_id);
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      const lost = await repository.transition(runner, before.id, 'paid', 'delivering', {});

      expect(lost).toBeNull();
      await runner.commitTransaction();
    } finally {
      await closeRunner(runner);
    }

    const after = await storedOrder(created.body.order_id);

    expect(after.status).toBe('created');
    expect(after.updated_at.getTime()).toBe(before.updated_at.getTime());
  });

  it('keeps COALESCEd stamps but clears an omitted failure_reason', async () => {
    const repository = harness.get(OrdersRepository);
    const created = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });
    const before = await storedOrder(created.body.order_id);
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      const paid = requireOrder(
        await repository.transition(runner, before.id, 'created', 'paid', { paidAt: new Date() }),
      );
      const delivering = requireOrder(
        await repository.transition(runner, before.id, 'paid', 'delivering', {}),
      );

      expect(delivering.paid_at?.getTime()).toBe(paid.paid_at?.getTime());

      const failed = requireOrder(
        await repository.transition(runner, before.id, 'delivering', 'delivery_failed', {
          failureReason: 'supplier timeout',
        }),
      );

      expect(failed.failure_reason).toBe('supplier timeout');

      const retried = requireOrder(
        await repository.transition(runner, before.id, 'delivery_failed', 'delivering', {}),
      );

      expect(retried.failure_reason).toBeNull();
      expect(retried.paid_at?.getTime()).toBe(paid.paid_at?.getTime());
      await runner.commitTransaction();
    } finally {
      await closeRunner(runner);
    }
  });

  it('returns null when locking an unknown ext_id', async () => {
    const repository = harness.get(OrdersRepository);
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      expect(await repository.lockForUpdate(runner, 'ord_missing')).toBeNull();
      await runner.commitTransaction();
    } finally {
      await closeRunner(runner);
    }
  });

  it('serialises two transactions on the named row lock', async () => {
    const repository = harness.get(OrdersRepository);
    const created = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });
    const extId = created.body.order_id;
    const runnerA = harness.dataSource.createQueryRunner();
    const runnerB = harness.dataSource.createQueryRunner();

    try {
      await runnerA.connect();
      await runnerA.startTransaction();

      const lockedA = requireOrder(await repository.lockForUpdate(runnerA, extId));

      expect(lockedA.status).toBe('created');
      await repository.transition(runnerA, lockedA.id, 'created', 'paid', { paidAt: new Date() });

      await runnerB.connect();
      await runnerB.startTransaction();

      const pendingB = repository.lockForUpdate(runnerB, extId);

      expect(await Promise.race([pendingB, delay(LOCK_PROBE_MS)])).toBe(PENDING);

      await runnerA.commitTransaction();

      const lockedB = requireOrder(await pendingB);

      expect(lockedB.status).toBe('paid');
      await runnerB.commitTransaction();
    } finally {
      await closeRunner(runnerB);
      await closeRunner(runnerA);
    }
  });

  it.each([
    {
      name: 'lockForUpdate',
      call: (repository: OrdersRepository, runner: QueryRunner) =>
        repository.lockForUpdate(runner, FIRST_EXT_ID),
    },
    {
      name: 'transition',
      call: (repository: OrdersRepository, runner: QueryRunner) =>
        repository.transition(runner, 1, 'created', 'paid', {}),
    },
  ])('refuses to run $name on a runner without an open transaction', async ({ call }) => {
    const repository = harness.get(OrdersRepository);
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();

      expect(runner.isTransactionActive).toBe(false);
      await expect(call(repository, runner)).rejects.toMatchObject({
        code: 'INTERNAL_ERROR',
        httpStatus: 500,
      });
    } finally {
      await closeRunner(runner);
    }
  });

  it('keeps the compare-and-swap predicate in the only status writer', () => {
    expect(ORDER_TRANSITION_SQL).toContain('WHERE id = $1 AND status = $2');
  });
});
