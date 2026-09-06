import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR_CODE } from '../../src/common/errors/errors.constants';
import type { IErrorEnvelope } from '../../src/common/errors/errors.interfaces';
import { JsonLogger } from '../../src/common/logging/json-logger';
import { LOG_EVENT } from '../../src/common/logging/logging.constants';
import { PAYMENT_FAILED_REASON } from '../../src/payments/payments.constants';
import type { PaymentWebhookResponseDto } from '../../src/payments/dto/payment-webhook.response.dto';
import type { CreateOrderResponseDto } from '../../src/orders/dto/create-order.response.dto';
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

interface IPaymentEventRow {
  order_id: number | null;
  state: string;
}

interface IOrderStatusRow {
  status: string;
  failure_reason: string | null;
}

interface IOrderStampsRow {
  paid_at: Date | null;
  last_payment_event_at: Date | null;
}

const TOPUP_SKU = 'STEAM-TOPUP-500';

const AMOUNT_MAJOR = 500;

const COUNT_ORDERS_SQL = 'SELECT count(*)::int AS count FROM orders';

const COUNT_JOBS_SQL = 'SELECT count(*)::int AS count FROM jobs';

const COUNT_LEDGER_TXNS_SQL = 'SELECT count(*)::int AS count FROM ledger_txns';

const BAD_REQUEST_STATUS = 400;

const COUNT_LEDGER_ENTRIES_SQL = 'SELECT count(*)::int AS count FROM ledger_entries';

const COUNT_PAYMENT_EVENTS_SQL = 'SELECT count(*)::int AS count FROM payment_events';

const SELECT_PAYMENT_EVENT_SQL = 'SELECT order_id, state FROM payment_events WHERE event_id = $1';

const SELECT_ORDER_STATUS_SQL = 'SELECT status, failure_reason FROM orders WHERE ext_id = $1';

const SELECT_ORDER_STAMPS_SQL = 'SELECT paid_at, last_payment_event_at FROM orders WHERE ext_id = $1';

// запас на расхождение часов процесса и Postgres при сверке серверной метки paid_at
const CLOCK_SKEW_MS = 60000;

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

async function scalarOf(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await harness.dataSource.query<ICountRow[]>(sql, params);
  const row = rows[0];

  if (row === undefined) {
    throw new Error('Запрос счётчика не вернул строку');
  }

  return row.count;
}

async function storedPaymentEvent(eventId: string): Promise<IPaymentEventRow> {
  const rows = await harness.dataSource.query<IPaymentEventRow[]>(SELECT_PAYMENT_EVENT_SQL, [eventId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Событие ${eventId} не найдено в базе`);
  }

  return row;
}

async function storedOrderStatus(extId: string): Promise<IOrderStatusRow> {
  const rows = await harness.dataSource.query<IOrderStatusRow[]>(SELECT_ORDER_STATUS_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row;
}

async function storedOrderStamps(extId: string): Promise<IOrderStampsRow> {
  const rows = await harness.dataSource.query<IOrderStampsRow[]>(SELECT_ORDER_STAMPS_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row;
}

async function createOrder(): Promise<string> {
  const { body } = await post<CreateOrderResponseDto>('/orders', { sku: TOPUP_SKU });

  return body.order_id;
}

function webhookPayload(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    event_id: 'evt_default',
    order_id: 'ord_00100',
    status: 'paid',
    amount: AMOUNT_MAJOR,
    currency: 'RUB',
    created_at: new Date().toISOString(),
    ...overrides,
  };
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

// vitest.config.mts не включает restoreMocks, а патч JsonLogger.prototype.write снимается в
// середине теста: упавший assert до mockRestore() оставил бы логгер подменённым до конца файла
afterEach(() => {
  vi.restoreAllMocks();
});

describe('POST /webhooks/payment', () => {
  // H6: дефолтный @IsISO8601() принимает всё это, а new Date() либо не парсит, либо тихо
  // искажает. Неразобранная дата уезжала в pg как "0NaN-NaN-NaN…", поднимала 22007 и
  // возвращалась клиенту как 500 — платёжка ретраила бы тот же event_id вечно.
  it.each([
    ['basic ISO 8601 format that Date cannot parse', '20250101T120000Z'],
    ['a calendar-impossible date that Date silently shifts', '2025-02-30T12:00:00Z'],
    ['a local time without an offset', '2025-01-01T12:00:00'],
  ])('rejects %s with 400 instead of 500', async (_label, createdAt) => {
    const extId = await createOrder();
    const payload = webhookPayload({ event_id: `evt_bad_date_${createdAt}`, order_id: extId, created_at: createdAt });

    const response = await post<IErrorEnvelope>('/webhooks/payment', payload);

    expect(response.status).toBe(BAD_REQUEST_STATUS);
    expect(response.body.error.code).toBe(ERROR_CODE.VALIDATION_FAILED);

    // ничего не должно остаться в БД: событие не принято
    expect(await scalarOf(COUNT_PAYMENT_EVENTS_SQL)).toBe(0);
  });

  it('is idempotent when the same event_id repeats', async () => {
    const extId = await createOrder();
    const payload = webhookPayload({ event_id: 'evt_dup_1', order_id: extId });

    const first = await post<PaymentWebhookResponseDto>('/webhooks/payment', payload);

    expect(first.status).toBe(200);
    expect(first.body).toEqual({
      accepted: true,
      result: 'applied',
      order_status: 'paid',
      event_id: 'evt_dup_1',
    });

    const replay = await post<PaymentWebhookResponseDto>('/webhooks/payment', payload);

    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({
      accepted: true,
      result: 'duplicate',
      order_status: null,
      event_id: 'evt_dup_1',
    });

    expect(await scalarOf(COUNT_PAYMENT_EVENTS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_JOBS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(2);
  });

  it('applies exactly one paid transition under 50 concurrent distinct events', async () => {
    const extId = await createOrder();
    const occurredAt = new Date().toISOString();
    const requests = Array.from({ length: 50 }, (_, index) =>
      post<PaymentWebhookResponseDto>(
        '/webhooks/payment',
        webhookPayload({ event_id: `evt_race_${index}`, order_id: extId, created_at: occurredAt }),
      ),
    );

    const results = await Promise.all(requests);

    expect(results.every((result) => result.status === 200)).toBe(true);

    const applied = results.filter((result) => result.body.result === 'applied');
    const ignored = results.filter((result) => result.body.result === 'ignored_already_paid');

    expect(applied).toHaveLength(1);
    expect(ignored).toHaveLength(49);

    const order = await storedOrderStatus(extId);

    expect(order.status).toBe('paid');
    expect(await scalarOf(COUNT_PAYMENT_EVENTS_SQL)).toBe(50);
    expect(await scalarOf(COUNT_JOBS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(2);
  });

  it('orphans a payment event for an unknown order_id', async () => {
    const payload = webhookPayload({ event_id: 'evt_orphan_1', order_id: 'ord_99999' });

    const { status, body } = await post<PaymentWebhookResponseDto>('/webhooks/payment', payload);

    expect(status).toBe(200);
    expect(body).toEqual({
      accepted: true,
      result: 'orphan',
      order_status: null,
      event_id: 'evt_orphan_1',
    });

    const event = await storedPaymentEvent('evt_orphan_1');

    expect(event.order_id).toBeNull();
    expect(event.state).toBe('orphan');
    expect(await scalarOf(COUNT_ORDERS_SQL)).toBe(0);
  });

  it('applies a failed payment and marks the order payment_failed', async () => {
    const extId = await createOrder();
    const payload = webhookPayload({ event_id: 'evt_failed_1', order_id: extId, status: 'failed' });

    const { status, body } = await post<PaymentWebhookResponseDto>('/webhooks/payment', payload);

    expect(status).toBe(200);
    expect(body).toEqual({
      accepted: true,
      result: 'applied',
      order_status: 'payment_failed',
      event_id: 'evt_failed_1',
    });

    const order = await storedOrderStatus(extId);

    expect(order.failure_reason).toBe(PAYMENT_FAILED_REASON);
    expect(await scalarOf(COUNT_JOBS_SQL)).toBe(0);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(0);
  });

  // M2: failed(T1) → paid(T2) — реальная вторая попытка списания. Раньше это был conflict:
  // заказ навсегда payment_failed, проводки payment_captured нет, доставка не поставлена,
  // а продюсера ADMIN_FORCE_PAID в системе не существует
  it('applies a paid event that follows a failed one and enqueues delivery', async () => {
    const extId = await createOrder();
    const failedAt = new Date(Date.now() - 60000).toISOString();
    // единственный переход, уводящий заказ из статуса, который задание считает финальным,
    // обязан быть виден при LOG_LEVEL=info: в payment.applied он отличается от рядового
    // created → paid только полем from_status, поэтому у него есть ещё и отдельный warn
    const logWrites = vi.spyOn(JsonLogger.prototype, 'write');

    const failed = await post<PaymentWebhookResponseDto>(
      '/webhooks/payment',
      webhookPayload({ event_id: 'evt_retry_failed', order_id: extId, status: 'failed', created_at: failedAt }),
    );

    expect(failed.body.order_status).toBe('payment_failed');

    const paid = await post<PaymentWebhookResponseDto>(
      '/webhooks/payment',
      webhookPayload({ event_id: 'evt_retry_paid', order_id: extId, created_at: new Date().toISOString() }),
    );

    expect(paid.status).toBe(200);
    expect(paid.body).toEqual({
      accepted: true,
      result: 'applied',
      order_status: 'paid',
      event_id: 'evt_retry_paid',
    });

    const order = await storedOrderStatus(extId);

    expect(order.status).toBe('paid');
    // причина отказа снята: failure_reason присваивается без COALESCE
    expect(order.failure_reason).toBeNull();
    expect(await scalarOf(COUNT_JOBS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);

    const records = logWrites.mock.calls.map(([record]) => record);

    logWrites.mockRestore();

    const escaped = records.filter((record) => record.event === LOG_EVENT.PAYMENT_FAILED_ESCAPED);

    expect(escaped).toHaveLength(1);
    expect(escaped[0].level).toBe('warn');
    expect(escaped[0].data).toMatchObject({
      order_id: extId,
      event_id: 'evt_retry_paid',
      from_status: 'payment_failed',
      to_status: 'paid',
    });

    const applied = records.filter(
      (record) => record.event === LOG_EVENT.PAYMENT_APPLIED && record.data?.event_id === 'evt_retry_paid',
    );

    expect(applied).toHaveLength(1);
    expect(applied[0].data).toMatchObject({ from_status: 'payment_failed' });
  });

  // M1: paid_at — серверные часы, время платёжной системы остаётся в last_payment_event_at.
  // Иначе перекошенный created_at уводит метку в 1970/будущее, и сверка «оплачен, но не выдан»
  // по давности (idx_orders_paid_undelivered построен на paid_at) молча теряет заказ
  it('stamps paid_at with server time while keeping the provider timestamp separately', async () => {
    const extId = await createOrder();
    const providerTime = '2001-02-03T04:05:06.000Z';
    const before = Date.now();

    await post<PaymentWebhookResponseDto>(
      '/webhooks/payment',
      webhookPayload({ event_id: 'evt_clock_1', order_id: extId, created_at: providerTime }),
    );

    const stamps = await storedOrderStamps(extId);

    expect(stamps.last_payment_event_at?.getTime()).toBe(Date.parse(providerTime));
    expect(stamps.paid_at).not.toBeNull();
    // границы с двух сторон: односторонняя проверка пропускала регрессию, уводящую метку
    // в будущее (ровно то, из-за чего paid_at и перевели на серверные часы)
    expect((stamps.paid_at as Date).getTime()).toBeGreaterThan(before - CLOCK_SKEW_MS);
    expect((stamps.paid_at as Date).getTime()).toBeLessThanOrEqual(Date.now() + CLOCK_SKEW_MS);
  });

  it('rejects a payment whose amount does not match the order', async () => {
    const extId = await createOrder();
    const payload = webhookPayload({ event_id: 'evt_amount_1', order_id: extId, amount: AMOUNT_MAJOR + 1 });

    const { status, body } = await post<PaymentWebhookResponseDto>('/webhooks/payment', payload);

    expect(status).toBe(200);
    expect(body).toEqual({
      accepted: true,
      result: 'rejected_amount',
      order_status: 'created',
      event_id: 'evt_amount_1',
    });

    const order = await storedOrderStatus(extId);

    expect(order.status).toBe('created');
    expect(await scalarOf(COUNT_JOBS_SQL)).toBe(0);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(0);
  });

  it('reports a conflict when a failed event arrives after paid', async () => {
    const extId = await createOrder();
    const firstAt = new Date();
    const secondAt = new Date(firstAt.getTime() + 1000);

    await post<PaymentWebhookResponseDto>(
      '/webhooks/payment',
      webhookPayload({ event_id: 'evt_conflict_1', order_id: extId, created_at: firstAt.toISOString() }),
    );

    const { status, body } = await post<PaymentWebhookResponseDto>(
      '/webhooks/payment',
      webhookPayload({
        event_id: 'evt_conflict_2',
        order_id: extId,
        status: 'failed',
        created_at: secondAt.toISOString(),
      }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      accepted: true,
      result: 'conflict',
      order_status: 'paid',
      event_id: 'evt_conflict_2',
    });

    expect(await scalarOf(COUNT_PAYMENT_EVENTS_SQL)).toBe(2);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);
  });

  it('ignores a stale event whose occurred_at precedes the last applied event', async () => {
    const extId = await createOrder();
    const laterAt = new Date();
    const earlierAt = new Date(laterAt.getTime() - 5000);

    await post<PaymentWebhookResponseDto>(
      '/webhooks/payment',
      webhookPayload({
        event_id: 'evt_stale_1',
        order_id: extId,
        status: 'failed',
        created_at: laterAt.toISOString(),
      }),
    );

    const { status, body } = await post<PaymentWebhookResponseDto>(
      '/webhooks/payment',
      webhookPayload({
        event_id: 'evt_stale_2',
        order_id: extId,
        status: 'paid',
        created_at: earlierAt.toISOString(),
      }),
    );

    expect(status).toBe(200);
    expect(body).toEqual({
      accepted: true,
      result: 'ignored_stale',
      order_status: 'payment_failed',
      event_id: 'evt_stale_2',
    });

    const order = await storedOrderStatus(extId);

    expect(order.status).toBe('payment_failed');
    expect(await scalarOf(COUNT_JOBS_SQL)).toBe(0);
    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(0);
  });

  it('accepts an unknown top-level field via lenient validation', async () => {
    const extId = await createOrder();
    const payload = { ...webhookPayload({ event_id: 'evt_lenient_1', order_id: extId }), foo: 'bar' };

    const { status, body } = await post<PaymentWebhookResponseDto>('/webhooks/payment', payload);

    expect(status).toBe(200);
    expect(body.result).toBe('applied');
  });

  it('rejects a missing event_id with 400 VALIDATION_FAILED', async () => {
    const extId = await createOrder();
    const payload = webhookPayload({ order_id: extId });

    delete payload.event_id;

    const { status, body } = await post<IErrorEnvelope>('/webhooks/payment', payload);

    expect(status).toBe(400);
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(await scalarOf(COUNT_PAYMENT_EVENTS_SQL)).toBe(0);
  });
});
