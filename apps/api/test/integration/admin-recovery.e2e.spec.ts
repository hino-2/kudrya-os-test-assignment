import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ADMIN_TOKEN_HEADER } from '../../src/admin/admin.constants';
import type { RedeliverResponseDto } from '../../src/admin/dto/redeliver.response.dto';
import type { RestockResponseDto } from '../../src/admin/dto/restock.response.dto';
import type { SweeperRunResponseDto } from '../../src/admin/dto/sweeper-run.response.dto';
import type { IErrorEnvelope } from '../../src/common/errors/errors.interfaces';
import { buildDeliverOrderDedupeKey } from '../../src/jobs/jobs.util';
import { ORDER_STATUS } from '../../src/orders/orders.constants';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';

const ADMIN_TOKEN = 'dev-admin-token';

const INSERT_POOL_PRODUCT_SQL = `
  INSERT INTO products (sku, name, type, price_minor, currency, fulfillment_mode, is_active, in_stock)
  VALUES ($1, 'Admin test key', 'key', 1000, 'RUB', 'pool', TRUE, TRUE)
  RETURNING id
`;

const INSERT_SUPPLIER_PRODUCT_SQL = `
  INSERT INTO products (sku, name, type, price_minor, currency, fulfillment_mode, is_active, in_stock)
  VALUES ($1, 'Admin test topup', 'topup', 1000, 'RUB', 'supplier', TRUE, TRUE)
  RETURNING id
`;

const INSERT_SKU_STOCK_SQL = 'INSERT INTO sku_stock (product_id, available_count) VALUES ($1, $2)';

const SELECT_AVAILABLE_COUNT_SQL = 'SELECT available_count FROM sku_stock WHERE product_id = $1';

const INSERT_ORDER_SQL = `
  INSERT INTO orders (ext_id, product_id, sku, unit_price_minor, total_minor, currency, status,
                      delivery_generation, paid_at)
  VALUES ($1, $2, $3, 1000, 1000, 'RUB', $4, $5, now())
  RETURNING id, ext_id
`;

const SELECT_ORDER_BY_EXT_ID_SQL = 'SELECT * FROM orders WHERE ext_id = $1';

const INSERT_STOCK_KEY_ISSUED_SQL = `
  INSERT INTO stock_keys (product_id, code, status, order_id)
  VALUES ($1, $2, 'issued', $3)
  RETURNING id
`;

const INSERT_ISSUED_DELIVERY_SQL = `
  INSERT INTO issued_deliveries (order_id, product_id, sku, code, source, stock_key_id)
  VALUES ($1, $2, $3, $4, 'pool', $5)
`;

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

interface IOrderRow {
  id: number;
  ext_id: string;
  status: string;
  delivery_generation: number;
}

interface IHttpResult<T> {
  status: number;
  body: T;
}

let harness: IApiHarness;
let nextSuffix = 0;

function uniqueId(): string {
  nextSuffix += 1;

  return `${Date.now()}-${nextSuffix}`;
}

async function post<T>(path: string, payload: unknown, token: string | null = ADMIN_TOKEN): Promise<IHttpResult<T>> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };

  if (token !== null) {
    headers[ADMIN_TOKEN_HEADER] = token;
  }

  const response = await fetch(`${harness.baseUrl}${path}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

async function insertPoolProduct(sku: string): Promise<number> {
  const rows = await harness.dataSource.query<Array<{ id: number }>>(INSERT_POOL_PRODUCT_SQL, [sku]);
  const productId = rows[0].id;

  await harness.dataSource.query(INSERT_SKU_STOCK_SQL, [productId, 0]);

  return productId;
}

async function insertSupplierProduct(sku: string, availableCount = 0): Promise<number> {
  const rows = await harness.dataSource.query<Array<{ id: number }>>(INSERT_SUPPLIER_PRODUCT_SQL, [sku]);
  const productId = rows[0].id;

  await harness.dataSource.query(INSERT_SKU_STOCK_SQL, [productId, availableCount]);

  return productId;
}

async function availableCountOf(productId: number): Promise<number> {
  const rows = await harness.dataSource.query<Array<{ available_count: number }>>(SELECT_AVAILABLE_COUNT_SQL, [
    productId,
  ]);

  return rows[0].available_count;
}

async function insertOrder(productId: number, status: string, deliveryGeneration = 0): Promise<IOrderRow> {
  const extId = `ord_admin_${uniqueId()}`;
  const rows = await harness.dataSource.query<Array<{ id: number; ext_id: string }>>(INSERT_ORDER_SQL, [
    extId,
    productId,
    `AD-${uniqueId()}`,
    status,
    deliveryGeneration,
  ]);

  return fetchOrder(rows[0].ext_id);
}

async function fetchOrder(extId: string): Promise<IOrderRow> {
  const rows = await harness.dataSource.query<IOrderRow[]>(SELECT_ORDER_BY_EXT_ID_SQL, [extId]);

  return rows[0];
}

async function insertIssuedDelivery(order: IOrderRow, productId: number): Promise<void> {
  const code = `KEY-${uniqueId()}`;
  const keyRows = await harness.dataSource.query<Array<{ id: number }>>(INSERT_STOCK_KEY_ISSUED_SQL, [
    productId,
    code,
    order.id,
  ]);

  await harness.dataSource.query(INSERT_ISSUED_DELIVERY_SQL, [order.id, productId, 'AD-DELIVERED', code, keyRows[0].id]);
}

async function jobExistsForDedupeKey(dedupeKey: string): Promise<boolean> {
  const rows = await harness.dataSource.query(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);

  return rows.length > 0;
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

describe('AdminTokenGuard', () => {
  it('rejects a request with no admin token', async () => {
    const { status, body } = await post<IErrorEnvelope>('/admin/sweeper/run', {}, null);

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a request with a wrong admin token', async () => {
    const { status, body } = await post<IErrorEnvelope>('/admin/sweeper/run', {}, 'wrong-token');

    expect(status).toBe(401);
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /admin/sweeper/run', () => {
  it('runs a sweep cycle and reports all pass counters', async () => {
    const { status, body } = await post<SweeperRunResponseDto>('/admin/sweeper/run', {});

    expect(status).toBe(200);
    expect(body).toEqual({
      reclaimed_stale_jobs: expect.any(Number),
      requeued_stuck_orders: expect.any(Number),
      retried_out_of_stock: expect.any(Number),
      retried_delivery_failed: expect.any(Number),
      demoted_stale_inflight: expect.any(Number),
      redriven_unknown_attempts: expect.any(Number),
      replayed_orphans: expect.any(Number),
      abandoned_orphans: expect.any(Number),
    });
  });
});

describe('POST /admin/products/:sku/restock', () => {
  it('adds explicit codes to a pool product', async () => {
    const sku = `AD-POOL-${uniqueId()}`;
    const productId = await insertPoolProduct(sku);

    const { status, body } = await post<RestockResponseDto>(`/admin/products/${sku}/restock`, {
      codes: ['code-1', 'code-2', 'code-3'],
    });

    expect(status).toBe(200);
    expect(body).toEqual({ added: 3, available_count: 3 });
    expect(await availableCountOf(productId)).toBe(3);
  });

  it('generates codes for a pool product given a count', async () => {
    const sku = `AD-POOL-${uniqueId()}`;

    await insertPoolProduct(sku);

    const { status, body } = await post<RestockResponseDto>(`/admin/products/${sku}/restock`, { count: 5 });

    expect(status).toBe(200);
    expect(body).toEqual({ added: 5, available_count: 5 });
  });

  it('bumps available_count for a supplier product given a count', async () => {
    const sku = `AD-SUP-${uniqueId()}`;
    const productId = await insertSupplierProduct(sku, 2);

    const { status, body } = await post<RestockResponseDto>(`/admin/products/${sku}/restock`, { count: 10 });

    expect(status).toBe(200);
    expect(body).toEqual({ added: 10, available_count: 12 });
    expect(await availableCountOf(productId)).toBe(12);
  });

  it('rejects explicit codes for a supplier product with 400', async () => {
    const sku = `AD-SUP-${uniqueId()}`;

    await insertSupplierProduct(sku);

    const { status, body } = await post<IErrorEnvelope>(`/admin/products/${sku}/restock`, { codes: ['x'] });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a body with both codes and count', async () => {
    const sku = `AD-POOL-${uniqueId()}`;

    await insertPoolProduct(sku);

    const { status, body } = await post<IErrorEnvelope>(`/admin/products/${sku}/restock`, {
      codes: ['x'],
      count: 1,
    });

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('rejects a body with neither codes nor count', async () => {
    const sku = `AD-POOL-${uniqueId()}`;

    await insertPoolProduct(sku);

    const { status, body } = await post<IErrorEnvelope>(`/admin/products/${sku}/restock`, {});

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
  });

  it('returns 404 for an unknown sku', async () => {
    const { status, body } = await post<IErrorEnvelope>('/admin/products/AD-UNKNOWN-SKU/restock', { count: 1 });

    expect(status).toBe(404);
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('POST /admin/orders/:orderId/redeliver', () => {
  it('redelivers an out_of_stock order and enqueues a fresh delivery job', async () => {
    const productId = await insertSupplierProduct(`AD-SUP-${uniqueId()}`, 5);
    const order = await insertOrder(productId, ORDER_STATUS.OUT_OF_STOCK, 1);

    const { status, body } = await post<RedeliverResponseDto>(`/admin/orders/${order.ext_id}/redeliver`, {});

    expect(status).toBe(202);
    expect(body).toEqual({ enqueued: true, generation: 2 });

    const updatedOrder = await fetchOrder(order.ext_id);

    expect(updatedOrder.status).toBe(ORDER_STATUS.DELIVERING);
    expect(updatedOrder.delivery_generation).toBe(2);
    expect(await jobExistsForDedupeKey(buildDeliverOrderDedupeKey(order.ext_id))).toBe(true);
  });

  it('redelivers a delivery_failed order and increments its generation', async () => {
    const productId = await insertSupplierProduct(`AD-SUP-${uniqueId()}`, 5);
    const order = await insertOrder(productId, ORDER_STATUS.DELIVERY_FAILED, 2);

    const { status, body } = await post<RedeliverResponseDto>(`/admin/orders/${order.ext_id}/redeliver`, {
      reason: 'manual retry',
    });

    expect(status).toBe(202);
    expect(body).toEqual({ enqueued: true, generation: 3 });
  });

  it('rejects an already-delivered order with 409', async () => {
    const productId = await insertPoolProduct(`AD-POOL-${uniqueId()}`);
    const order = await insertOrder(productId, ORDER_STATUS.DELIVERED, 1);

    await insertIssuedDelivery(order, productId);

    const { status, body } = await post<IErrorEnvelope>(`/admin/orders/${order.ext_id}/redeliver`, {});

    expect(status).toBe(409);
    expect(body.error.code).toBe('ORDER_ALREADY_DELIVERED');
  });

  it('rejects a non-recoverable order with 409', async () => {
    const productId = await insertPoolProduct(`AD-POOL-${uniqueId()}`);
    const order = await insertOrder(productId, ORDER_STATUS.PAID, 0);

    const { status, body } = await post<IErrorEnvelope>(`/admin/orders/${order.ext_id}/redeliver`, {});

    expect(status).toBe(409);
    expect(body.error.code).toBe('ORDER_NOT_RECOVERABLE');
  });

  it('returns 404 for an unknown orderId', async () => {
    const { status, body } = await post<IErrorEnvelope>('/admin/orders/ord_unknown_00000/redeliver', {});

    expect(status).toBe(404);
    expect(body.error.code).toBe('ORDER_NOT_FOUND');
  });
});
