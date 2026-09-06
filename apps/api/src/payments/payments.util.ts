import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import type { OrderEvent, OrderStatus } from '../orders/orders.type';
import { ORDER_EVENT } from '../orders/orders.constants';
import {
  AMOUNT_MISMATCH_REASON_TEMPLATE,
  CONFLICT_EVENT_REASON_TEMPLATE,
  IGNORED_EVENT_REASON_TEMPLATE,
  PAYMENT_EVENT_STATE,
  STALE_EVENT_REASON_TEMPLATE,
  WEBHOOK_INVALID_CREATED_AT_MESSAGE,
} from './payments.constants';
import type { PaymentEventState, PaymentStatus, RawWebhookPayload } from './payments.type';

function formatTemplate(template: string, ...values: readonly unknown[]): string {
  let index = 0;

  return template.replace(/%s/g, () => String(values[index++]));
}

// DTO уже требует strict-ISO8601 со смещением, но валидатор и Date расходятся на краевых
// значениях, а неразобранная дата уехала бы в pg как "0NaN-NaN-NaN…", подняла бы 22007 и
// вернулась клиенту как 500 — платёжная система ретраила бы тот же event_id вечно.
// Поэтому явная проверка: битый вход обязан быть 400, а не 500.
export function parseOccurredAt(createdAt: string): Date {
  const timestamp = Date.parse(createdAt);

  if (Number.isNaN(timestamp)) {
    throw new DomainError(ERROR_CODE.VALIDATION_FAILED, WEBHOOK_INVALID_CREATED_AT_MESSAGE, {
      created_at: createdAt,
    });
  }

  return new Date(timestamp);
}

export function toOrderEvent(status: PaymentStatus): OrderEvent {
  return status === 'paid' ? ORDER_EVENT.PAYMENT_PAID : ORDER_EVENT.PAYMENT_FAILED;
}

export function resolveIgnoredState(event: OrderEvent): PaymentEventState {
  return event === ORDER_EVENT.PAYMENT_PAID
    ? PAYMENT_EVENT_STATE.IGNORED_ALREADY_PAID
    : PAYMENT_EVENT_STATE.IGNORED_TERMINAL;
}

export function buildAmountMismatchReason(
  expectedMinor: MinorAmount,
  expectedCurrency: CurrencyCode,
  actualMinor: MinorAmount,
  actualCurrency: CurrencyCode,
): string {
  return formatTemplate(
    AMOUNT_MISMATCH_REASON_TEMPLATE,
    expectedMinor,
    expectedCurrency,
    actualMinor,
    actualCurrency,
  );
}

export function buildStaleReason(occurredAt: Date, lastPaymentEventAt: Date): string {
  return formatTemplate(
    STALE_EVENT_REASON_TEMPLATE,
    occurredAt.toISOString(),
    lastPaymentEventAt.toISOString(),
  );
}

export function buildIgnoredReason(fromStatus: OrderStatus, event: OrderEvent): string {
  return formatTemplate(IGNORED_EVENT_REASON_TEMPLATE, fromStatus, event);
}

export function buildConflictReason(fromStatus: OrderStatus, event: OrderEvent): string {
  return formatTemplate(CONFLICT_EVENT_REASON_TEMPLATE, fromStatus, event);
}

export function toRawPayload(body: unknown, dto: object): RawWebhookPayload {
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    return body as RawWebhookPayload;
  }

  return { ...dto };
}
