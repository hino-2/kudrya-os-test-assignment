import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IErrorEnvelope } from '../../src/common/errors/errors.interfaces';
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

const TOPUP_SKU = 'STEAM-TOPUP-500';

const AMOUNT_MAJOR = 500;

const COUNT_ORDERS_SQL = 'SELECT count(*)::int AS count FROM orders';

const COUNT_JOBS_SQL = 'SELECT count(*)::int AS count FROM jobs';

const COUNT_LEDGER_TXNS_SQL = 'SELECT count(*)::int AS count FROM ledger_txns';

const COUNT_LEDGER_ENTRIES_SQL = 'SELECT count(*)::int AS count FROM ledger_entries';

const COUNT_PAYMENT_EVENTS_SQL = 'SELECT count(*)::int AS count FROM payment_events';

const SELECT_PAYMENT_EVENT_SQL = 'SELECT order_id, state FROM payment_events WHERE event_id = $1';

const SELECT_ORDER_STATUS_SQL = 'SELECT status, failure_reason FROM orders WHERE ext_id = $1';

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

describe('POST /webhooks/payment', () => {
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
