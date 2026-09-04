import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import type { OrderStatus } from '../orders/orders.type';
import type { PaymentEventState, PaymentStatus, RawWebhookPayload, WebhookResult } from './payments.type';

export interface IOrphanEventRow {
  id: number;
  event_id: string;
  order_ext_id: string;
  status: PaymentStatus;
  amount_minor: MinorAmount;
  currency: CurrencyCode;
  occurred_at: Date;
  raw_payload: RawWebhookPayload;
  trace_id: string | null;
}

export interface IPaymentEventInput {
  eventId: string;
  orderExtId: string;
  status: PaymentStatus;
  amountMinor: MinorAmount;
  currency: CurrencyCode;
  occurredAt: Date;
  rawPayload: RawWebhookPayload;
  traceId: string | null;
}

export interface IPaymentEventFinalisation {
  id: number;
  state: PaymentEventState;
  orderId: number | null;
  ignoreReason: string | null;
  appliedFromStatus: OrderStatus | null;
  appliedToStatus: OrderStatus | null;
}

export interface IWebhookOutcome {
  result: WebhookResult;
  orderStatus: OrderStatus | null;
  eventId: string;
  paymentEventId: number | null;
  jobId: number | null;
}

export interface IPaymentEventIdRow {
  id: number;
}
