import { toMajor } from '../common/money/money.util';
import { isRecoverable, isTerminal } from './order-state-machine';
import type { IOrderDetail, IOrderRow } from './orders.interfaces';
import { toIsoOrNull } from './orders.util';
import type { CreateOrderResponseDto } from './dto/create-order.response.dto';
import type { OrderResponseDto } from './dto/order.response.dto';

export function toCreateOrderResponse(row: IOrderRow): CreateOrderResponseDto {
  return {
    order_id: row.ext_id,
    status: row.status,
    sku: row.sku,
    quantity: row.quantity,
    amount_minor: row.total_minor,
    amount: toMajor(row.total_minor),
    currency: row.currency,
    created_at: row.created_at.toISOString(),
  };
}

export function toOrderResponse(detail: IOrderDetail): OrderResponseDto {
  const { order, delivery } = detail;

  return {
    order_id: order.ext_id,
    status: order.status,
    recoverable: isRecoverable(order.status),
    terminal: isTerminal(order.status),
    sku: order.sku,
    quantity: order.quantity,
    amount_minor: order.total_minor,
    amount: toMajor(order.total_minor),
    currency: order.currency,
    created_at: order.created_at.toISOString(),
    paid_at: toIsoOrNull(order.paid_at),
    delivered_at: toIsoOrNull(order.delivered_at),
    failure_reason: order.failure_reason,
    delivery:
      delivery === null
        ? null
        : {
            code: delivery.code,
            source: delivery.source,
            supplier: delivery.supplier_code,
            delivered_at: delivery.delivered_at.toISOString(),
          },
    payment_events: detail.paymentEvents.map((event) => ({
      event_id: event.event_id,
      status: event.status,
      state: event.state,
      occurred_at: event.occurred_at.toISOString(),
      received_at: event.received_at.toISOString(),
    })),
    delivery_attempts: detail.deliveryAttempts.map((attempt) => ({
      supplier: attempt.supplier_code,
      attempt_no: attempt.attempt_no,
      request_id: attempt.request_id,
      state: attempt.state,
      error_kind: attempt.error_kind,
      duration_ms: attempt.duration_ms,
    })),
  };
}
