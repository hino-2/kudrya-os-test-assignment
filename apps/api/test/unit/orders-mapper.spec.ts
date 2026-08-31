import { describe, expect, it } from 'vitest';

import { toCreateOrderResponse, toOrderResponse } from '../../src/orders/orders.mapper';
import { ORDER_STATUS_VALUES } from '../../src/orders/orders.constants';
import type { IOrderDetail, IOrderRow } from '../../src/orders/orders.interfaces';

const CREATED_AT = new Date('2026-08-31T10:00:00.000Z');

function row(overrides: Partial<IOrderRow> = {}): IOrderRow {
  return {
    id: 42,
    ext_id: 'ord_00100',
    product_id: 7,
    sku: 'STEAM-TOPUP-500',
    quantity: 1,
    unit_price_minor: 50000,
    total_minor: 50000,
    currency: 'RUB',
    status: 'created',
    buyer_email: null,
    failure_reason: null,
    delivery_generation: 0,
    last_payment_event_id: null,
    last_payment_event_at: null,
    paid_at: null,
    delivering_at: null,
    delivered_at: null,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    ...overrides,
  };
}

function detail(overrides: Partial<IOrderDetail> = {}): IOrderDetail {
  return {
    order: row(),
    delivery: null,
    paymentEvents: [],
    deliveryAttempts: [],
    ...overrides,
  };
}

describe('orders.mapper', () => {
  describe('toCreateOrderResponse', () => {
    it('exposes both the authoritative minor amount and the display amount', () => {
      const body = toCreateOrderResponse(row());

      expect(body.amount_minor).toBe(50000);
      expect(body.amount).toBe(500);
      expect(body.currency).toBe('RUB');
    });

    it('publishes ext_id as order_id and never the internal id', () => {
      const body = toCreateOrderResponse(row());

      expect(body.order_id).toBe('ord_00100');
      expect(Object.keys(body)).not.toContain('id');
      expect(Object.keys(body)).not.toContain('buyer_email');
    });

    it('renders created_at as an ISO string', () => {
      expect(toCreateOrderResponse(row()).created_at).toBe('2026-08-31T10:00:00.000Z');
    });
  });

  describe('toOrderResponse', () => {
    it.each(ORDER_STATUS_VALUES)('derives recoverable and terminal for %s', (status) => {
      const body = toOrderResponse(detail({ order: row({ status }) }));

      expect(body.recoverable).toBe(status === 'out_of_stock' || status === 'delivery_failed');
      expect(body.terminal).toBe(status === 'delivered' || status === 'payment_failed');
    });

    it('keeps null timestamps null', () => {
      const body = toOrderResponse(detail());

      expect(body.paid_at).toBeNull();
      expect(body.delivered_at).toBeNull();
      expect(body.failure_reason).toBeNull();
    });

    it('renders present timestamps as ISO strings', () => {
      const paidAt = new Date('2026-08-31T10:05:00.000Z');
      const body = toOrderResponse(detail({ order: row({ status: 'paid', paid_at: paidAt }) }));

      expect(body.paid_at).toBe('2026-08-31T10:05:00.000Z');
    });

    it('reports no delivery when the order has none', () => {
      expect(toOrderResponse(detail()).delivery).toBeNull();
    });

    it('renames supplier_code to supplier in the delivery block', () => {
      const body = toOrderResponse(
        detail({
          delivery: {
            code: 'A7X1-B2C3-D4CD',
            source: 'supplier',
            supplier_code: 'A',
            delivered_at: new Date('2026-08-31T10:10:00.000Z'),
          },
        }),
      );

      expect(body.delivery).toEqual({
        code: 'A7X1-B2C3-D4CD',
        source: 'supplier',
        supplier: 'A',
        delivered_at: '2026-08-31T10:10:00.000Z',
      });
    });

    it('maps the collections element-wise and preserves their order', () => {
      const body = toOrderResponse(
        detail({
          paymentEvents: [
            {
              event_id: 'evt_2',
              status: 'paid',
              state: 'applied',
              occurred_at: new Date('2026-08-31T10:02:00.000Z'),
              received_at: new Date('2026-08-31T10:02:01.000Z'),
            },
            {
              event_id: 'evt_1',
              status: 'paid',
              state: 'duplicate',
              occurred_at: new Date('2026-08-31T10:01:00.000Z'),
              received_at: new Date('2026-08-31T10:01:01.000Z'),
            },
          ],
          deliveryAttempts: [
            {
              supplier_code: 'A',
              attempt_no: 1,
              request_id: 'req_ord_00100_A_1',
              state: 'failed',
              error_kind: 'timeout',
              duration_ms: 3000,
            },
            {
              supplier_code: 'B',
              attempt_no: 1,
              request_id: 'req_ord_00100_B_1',
              state: 'succeeded',
              error_kind: null,
              duration_ms: 412,
            },
          ],
        }),
      );

      expect(body.payment_events.map((event) => event.event_id)).toEqual(['evt_2', 'evt_1']);
      expect(body.payment_events[0].occurred_at).toBe('2026-08-31T10:02:00.000Z');
      expect(body.delivery_attempts.map((attempt) => attempt.supplier)).toEqual(['A', 'B']);
      expect(body.delivery_attempts[1]).toEqual({
        supplier: 'B',
        attempt_no: 1,
        request_id: 'req_ord_00100_B_1',
        state: 'succeeded',
        error_kind: null,
        duration_ms: 412,
      });
    });
  });
});
