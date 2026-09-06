import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DeliveryService } from '../../src/delivery/delivery.service';
import { LEDGER_TXN_KIND } from '../../src/ledger/ledger.constants';
import { ORDER_STATUS } from '../../src/orders/orders.constants';
import type { CreateOrderResponseDto } from '../../src/orders/dto/create-order.response.dto';
import type { PaymentWebhookResponseDto } from '../../src/payments/dto/payment-webhook.response.dto';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';
import { seedCatalog } from '../helpers/seed.helper';
import { waitForCondition } from '../helpers/wait-for';

interface IHttpResult<T> {
  status: number;
  body: T;
}

interface IOrderRow {
  id: number;
  status: string;
  delivery_generation: number;
  failure_reason: string | null;
  delivered_at: string | null;
}

interface ISkuStockRow {
  available_count: number;
  reserved_count: number;
  issued_count: number;
}

interface IStockKeyRow {
  status: string;
  order_id: number | null;
}

interface IIssuedDeliveryRow {
  code: string;
  source: string;
  stock_key_id: number | null;
}

interface ICountRow {
  count: number;
}

const POOL_SKU = 'KEY-CS2-PRIME';

const POOL_SKU_AMOUNT_MAJOR = 1290;

const DRAIN_SKU = 'KEY-EFT';

const DRAIN_SKU_AMOUNT_MAJOR = 3490;

const SELECT_ORDER_SQL =
  'SELECT id, status, delivery_generation, failure_reason, delivered_at FROM orders WHERE ext_id = $1';

const SELECT_SKU_STOCK_SQL = `
  SELECT s.available_count, s.reserved_count, s.issued_count
  FROM sku_stock s
  JOIN products p ON p.id = s.product_id
  WHERE p.sku = $1
`;

const SELECT_PRODUCT_IN_STOCK_SQL = 'SELECT in_stock FROM products WHERE sku = $1';

const SELECT_STOCK_KEYS_FOR_ORDER_SQL =
  'SELECT status, order_id FROM stock_keys WHERE order_id = $1';

const SELECT_ISSUED_DELIVERY_SQL =
  'SELECT code, source, stock_key_id FROM issued_deliveries WHERE order_id = $1';

const COUNT_ISSUED_DELIVERIES_FOR_ORDER_SQL =
  'SELECT count(*)::int AS count FROM issued_deliveries WHERE order_id = $1';

const COUNT_LEDGER_TXNS_SQL =
  'SELECT count(*)::int AS count FROM ledger_txns WHERE order_id = $1 AND kind = $2';

const DELETE_STOCK_KEYS_FOR_SKU_SQL = `
  DELETE FROM stock_keys WHERE product_id = (SELECT id FROM products WHERE sku = $1)
`;

const SELECT_EXT_ID_SQL = 'SELECT ext_id FROM orders WHERE id = $1';

const KEEP_SINGLE_STOCK_KEY_SQL = `
  DELETE FROM stock_keys
  WHERE product_id = (SELECT id FROM products WHERE sku = $1)
    AND id <> (
      SELECT min(id) FROM stock_keys
      WHERE product_id = (SELECT id FROM products WHERE sku = $1) AND status = 'available'
    )
`;

const SET_AVAILABLE_COUNT_SQL = `
  UPDATE sku_stock SET available_count = $2
  WHERE product_id = (SELECT id FROM products WHERE sku = $1)
`;

const LOCK_AVAILABLE_KEYS_SQL = `
  SELECT id FROM stock_keys
  WHERE product_id = (SELECT id FROM products WHERE sku = $1) AND status = 'available'
  FOR UPDATE
`;

const LOCK_SKU_STOCK_ROW_SQL = `
  SELECT available_count FROM sku_stock
  WHERE product_id = (SELECT id FROM products WHERE sku = $1)
  FOR UPDATE
`;

const INSERT_AVAILABLE_KEYS_SQL = `
  INSERT INTO stock_keys (product_id, code, status, batch)
  SELECT (SELECT id FROM products WHERE sku = $1), 'restocked-' || g, 'available', 'test'
  FROM generate_series(1, $2) AS g
`;

// ждём, пока пересчёт реально упрётся в блокировку строки остатка: без этого тест мог бы
// проверить не тот порядок событий
// ждём ожидания блокировки через pg_stat_activity, а не pg_locks: pg_locks кластерный, и любой
// ждущий бэкенд из чужой базы дал бы ложное срабатывание — тест тогда зеленел бы, не воспроизведя
// само чередование. wait_event_type = 'Lock' — это ровно ожидание блокировки.
const COUNT_LOCK_WAITERS_SQL = `
  SELECT count(*)::int AS count FROM pg_stat_activity
  WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
`;

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

async function createPaidOrder(
  sku: string,
  amountMajor: number,
  eventId: string,
): Promise<IOrderRow> {
  const extId = await createOrder(sku);

  await payOrder(extId, amountMajor, eventId);

  return fetchOrder(extId);
}

async function fetchOrder(extId: string): Promise<IOrderRow> {
  const rows = await harness.dataSource.query<IOrderRow[]>(SELECT_ORDER_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row;
}

async function fetchExtId(orderId: number): Promise<string> {
  const rows = await harness.dataSource.query<{ ext_id: string }[]>(SELECT_EXT_ID_SQL, [orderId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`ext_id для заказа ${orderId} не найден`);
  }

  return row.ext_id;
}

async function fetchOrderById(orderId: number): Promise<IOrderRow> {
  const extId = await fetchExtId(orderId);

  return fetchOrder(extId);
}

async function fetchSkuStock(sku: string): Promise<ISkuStockRow> {
  const rows = await harness.dataSource.query<ISkuStockRow[]>(SELECT_SKU_STOCK_SQL, [sku]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Остаток для ${sku} не найден в базе`);
  }

  return row;
}

async function fetchProductInStock(sku: string): Promise<boolean> {
  const rows = await harness.dataSource.query<{ in_stock: boolean }[]>(
    SELECT_PRODUCT_IN_STOCK_SQL,
    [sku],
  );
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Товар ${sku} не найден в базе`);
  }

  return row.in_stock;
}

async function fetchStockKeysForOrder(orderId: number): Promise<IStockKeyRow[]> {
  return harness.dataSource.query<IStockKeyRow[]>(SELECT_STOCK_KEYS_FOR_ORDER_SQL, [orderId]);
}

async function fetchIssuedDelivery(orderId: number): Promise<IIssuedDeliveryRow | null> {
  const rows = await harness.dataSource.query<IIssuedDeliveryRow[]>(SELECT_ISSUED_DELIVERY_SQL, [
    orderId,
  ]);

  return rows[0] ?? null;
}

async function countIssuedDeliveries(orderId: number): Promise<number> {
  const rows = await harness.dataSource.query<ICountRow[]>(COUNT_ISSUED_DELIVERIES_FOR_ORDER_SQL, [
    orderId,
  ]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error('Запрос счётчика не вернул строку');
  }

  return row.count;
}

async function countLedgerTxns(orderId: number, kind: string): Promise<number> {
  const rows = await harness.dataSource.query<ICountRow[]>(COUNT_LEDGER_TXNS_SQL, [orderId, kind]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error('Запрос счётчика не вернул строку');
  }

  return row.count;
}

async function drainAllKeys(sku: string): Promise<void> {
  await harness.dataSource.query(DELETE_STOCK_KEYS_FOR_SKU_SQL, [sku]);
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

describe('pool delivery (WORKER_ENABLED=false, direct DeliveryService calls)', () => {
  it('delivers a pool key end-to-end and posts the delivery_recognized ledger entry', async () => {
    const order = await createPaidOrder(POOL_SKU, POOL_SKU_AMOUNT_MAJOR, 'evt_pool_happy');
    const deliveryService = harness.get(DeliveryService);

    const result = await deliveryService.deliver({
      orderId: order.id,
      generation: order.delivery_generation,
    });

    expect(result.outcome).toBe('delivered');
    expect(result.code).not.toBeNull();

    const updated = await fetchOrderById(order.id);

    expect(updated.status).toBe(ORDER_STATUS.DELIVERED);
    expect(updated.delivered_at).not.toBeNull();

    const issued = await fetchIssuedDelivery(order.id);

    expect(issued).not.toBeNull();
    expect(issued?.code).toBe(result.code);
    expect(issued?.source).toBe('pool');

    const keys = await fetchStockKeysForOrder(order.id);

    expect(keys).toHaveLength(1);
    expect(keys[0]?.status).toBe('issued');

    const stock = await fetchSkuStock(POOL_SKU);

    expect(stock.available_count).toBe(19);
    expect(stock.reserved_count).toBe(0);
    expect(stock.issued_count).toBe(1);

    expect(await countLedgerTxns(order.id, LEDGER_TXN_KIND.DELIVERY_RECOGNIZED)).toBe(1);
  });

  it('is idempotent on concurrent redelivery attempts for the same order (only one key issued)', async () => {
    const order = await createPaidOrder(POOL_SKU, POOL_SKU_AMOUNT_MAJOR, 'evt_pool_race');
    const deliveryService = harness.get(DeliveryService);
    const input = { orderId: order.id, generation: order.delivery_generation };

    const [first, second] = await Promise.all([
      deliveryService.deliver(input),
      deliveryService.deliver(input),
    ]);

    expect(first.code).toBe(second.code);
    expect([first.outcome, second.outcome].sort()).toEqual(['already_delivered', 'delivered']);

    expect(await countIssuedDeliveries(order.id)).toBe(1);
    expect(await countLedgerTxns(order.id, LEDGER_TXN_KIND.DELIVERY_RECOGNIZED)).toBe(1);

    const stock = await fetchSkuStock(POOL_SKU);

    expect(stock.issued_count).toBe(1);
  });

  it('moves the order to out_of_stock when the pool has no available key left', async () => {
    const order = await createPaidOrder(DRAIN_SKU, DRAIN_SKU_AMOUNT_MAJOR, 'evt_pool_drained');

    await drainAllKeys(DRAIN_SKU);

    const deliveryService = harness.get(DeliveryService);
    const result = await deliveryService.deliver({
      orderId: order.id,
      generation: order.delivery_generation,
    });

    expect(result).toEqual({ outcome: 'out_of_stock', code: null });

    const updated = await fetchOrderById(order.id);

    expect(updated.status).toBe(ORDER_STATUS.OUT_OF_STOCK);
    expect(updated.failure_reason).toBe('out_of_stock');

    expect(await fetchProductInStock(DRAIN_SKU)).toBe(false);
    expect(await countIssuedDeliveries(order.id)).toBe(0);
    expect(await countLedgerTxns(order.id, LEDGER_TXN_KIND.DELIVERY_RECOGNIZED)).toBe(0);

    const stock = await fetchSkuStock(DRAIN_SKU);

    expect(stock.available_count).toBe(0);
  });

  // H4: reserveKey отдаёт null и когда ключей нет, и когда все свободные заблокированы
  // конкурентной транзакцией (FOR UPDATE SKIP LOCKED). Раньше оба случая обнуляли счётчик,
  // из-за чего живой ключ навсегда исчезал с витрины (products.in_stock = false), а счётчики
  // оставались занижены. Теперь счётчик пересчитывается по факту.
  it('keeps the counters truthful when reserveKey only lost a SKIP LOCKED race', async () => {
    await harness.dataSource.query(KEEP_SINGLE_STOCK_KEY_SQL, [DRAIN_SKU]);
    await harness.dataSource.query(SET_AVAILABLE_COUNT_SQL, [DRAIN_SKU, 1]);

    const order = await createPaidOrder(DRAIN_SKU, DRAIN_SKU_AMOUNT_MAJOR, 'evt_pool_skip_locked');
    const holder = harness.dataSource.createQueryRunner();

    await holder.connect();
    await holder.startTransaction();

    try {
      // держим единственный свободный ключ: SKIP LOCKED у доставки его пропустит,
      // но статус ключа остаётся 'available', то есть остаток реально есть
      const locked = (await holder.query(LOCK_AVAILABLE_KEYS_SQL, [DRAIN_SKU])) as unknown[];

      expect(locked).toHaveLength(1);

      const deliveryService = harness.get(DeliveryService);
      const result = await deliveryService.deliver({
        orderId: order.id,
        generation: order.delivery_generation,
      });

      expect(result).toEqual({ outcome: 'out_of_stock', code: null });

      const stock = await fetchSkuStock(DRAIN_SKU);

      // ключ жив, поэтому счётчик обязан остаться 1, а товар — видимым в каталоге
      expect(stock.available_count).toBe(1);
      expect(await fetchProductInStock(DRAIN_SKU)).toBe(true);
      expect(await countIssuedDeliveries(order.id)).toBe(0);
    } finally {
      await holder.rollbackTransaction();
      await holder.release();
    }
  });

  // H-1: пересчёт обязан брать блокировку строки остатка отдельным оператором. Если он этого
  // не делает, снапшот его подзапроса не продвигается через ожидание блокировки (EvalPlanQual
  // переиспользует es_snapshot оператора), и пересчёт затирает уже закоммиченный admin-restock:
  // счётчик уезжает в 0 при живых ключах, товар исчезает с витрины, а проход 3 sweeper'а его
  // не поднимет, потому что требует available_count > 0.
  it('does not erase a restock that commits while the recount waits for the stock row lock', async () => {
    await harness.dataSource.query(DELETE_STOCK_KEYS_FOR_SKU_SQL, [DRAIN_SKU]);
    await harness.dataSource.query(SET_AVAILABLE_COUNT_SQL, [DRAIN_SKU, 0]);

    const order = await createPaidOrder(DRAIN_SKU, DRAIN_SKU_AMOUNT_MAJOR, 'evt_pool_restock_race');
    const holder = harness.dataSource.createQueryRunner();

    await holder.connect();
    await holder.startTransaction();

    try {
      await holder.query(LOCK_SKU_STOCK_ROW_SQL, [DRAIN_SKU]);

      const deliveryService = harness.get(DeliveryService);
      // не ждём: доставка не найдёт ключей, пойдёт в пересчёт и упрётся в блокировку выше
      // .catch гасит шум: если ожидание ниже отвалится по таймауту, эта промис-цепочка
      // упадёт по lock timeout уже после finally и заслонила бы настоящую причину падения
      const deliveryPromise = deliveryService
        .deliver({ orderId: order.id, generation: order.delivery_generation })
        .catch((error: unknown) => error);

      await waitForCondition(
        async () => {
          const rows = await harness.dataSource.query<ICountRow[]>(COUNT_LOCK_WAITERS_SQL);

          return (rows[0]?.count ?? 0) > 0;
        },
        { message: 'пересчёт так и не упёрся в блокировку строки остатка' },
      );

      // admin-restock коммитится, пока пересчёт стоит в очереди за блокировкой
      await holder.query(INSERT_AVAILABLE_KEYS_SQL, [DRAIN_SKU, 3]);
      await holder.query(SET_AVAILABLE_COUNT_SQL, [DRAIN_SKU, 3]);
      await holder.commitTransaction();

      const result = await deliveryPromise;

      expect(result).toMatchObject({ outcome: 'out_of_stock' });

      const stock = await fetchSkuStock(DRAIN_SKU);

      // пополнение обязано выжить: 3 живых ключа — значит 3 в счётчике, а не 0
      expect(stock.available_count).toBe(3);
      expect(await fetchProductInStock(DRAIN_SKU)).toBe(true);
    } finally {
      if (holder.isTransactionActive) {
        await holder.rollbackTransaction();
      }

      await holder.release();
    }
  });

  it('replays already_delivered with the same code and does not double-count on a second call', async () => {
    const order = await createPaidOrder(POOL_SKU, POOL_SKU_AMOUNT_MAJOR, 'evt_pool_already');
    const deliveryService = harness.get(DeliveryService);
    const input = { orderId: order.id, generation: order.delivery_generation };

    const first = await deliveryService.deliver(input);
    const second = await deliveryService.deliver(input);

    expect(first.outcome).toBe('delivered');
    expect(second).toEqual({ outcome: 'already_delivered', code: first.code });

    expect(await countIssuedDeliveries(order.id)).toBe(1);
    expect(await countLedgerTxns(order.id, LEDGER_TXN_KIND.DELIVERY_RECOGNIZED)).toBe(1);

    const stock = await fetchSkuStock(POOL_SKU);

    expect(stock.available_count).toBe(19);
    expect(stock.issued_count).toBe(1);
  });

  it('skips a stale job whose generation no longer matches the order', async () => {
    const order = await createPaidOrder(POOL_SKU, POOL_SKU_AMOUNT_MAJOR, 'evt_pool_stale_gen');
    const deliveryService = harness.get(DeliveryService);

    const result = await deliveryService.deliver({
      orderId: order.id,
      generation: order.delivery_generation + 1,
    });

    expect(result).toEqual({ outcome: 'skipped', code: null });
    expect(await countIssuedDeliveries(order.id)).toBe(0);

    const updated = await fetchOrderById(order.id);

    expect(updated.status).toBe(ORDER_STATUS.PAID);
  });
});
