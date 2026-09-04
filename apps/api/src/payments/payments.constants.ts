import type { LogEventName } from '../common/logging/logging.type';
import { LOG_EVENT } from '../common/logging/logging.constants';
import type { WebhookResult } from './payments.type';

export const PAYMENT_STATUS = {
  PAID: 'paid',
  FAILED: 'failed',
} as const;

export const PAYMENT_EVENT_STATE = {
  PENDING: 'pending',
  APPLIED: 'applied',
  ORPHAN: 'orphan',
  ABANDONED: 'abandoned',
  IGNORED_STALE: 'ignored_stale',
  IGNORED_ALREADY_PAID: 'ignored_already_paid',
  IGNORED_TERMINAL: 'ignored_terminal',
  CONFLICT: 'conflict',
  REJECTED_AMOUNT: 'rejected_amount',
} as const;

export const PAYMENTS_ROUTE = 'webhooks';

export const PAYMENT_WEBHOOK_PATH = 'payment';

export const PAYMENT_WEBHOOK_STATUS = 200;

export const EVENT_ID_MIN_LENGTH = 1;

export const EVENT_ID_MAX_LENGTH = 128;

export const WEBHOOK_AMOUNT_MIN = 0;

export const WEBHOOK_STATUS_VALUES = [PAYMENT_STATUS.PAID, PAYMENT_STATUS.FAILED] as const;

export const WEBHOOK_CURRENCY_VALUES = ['RUB'] as const;

export const WEBHOOK_RESULT = {
  APPLIED: 'applied',
  DUPLICATE: 'duplicate',
  ORPHAN: 'orphan',
  IGNORED_STALE: 'ignored_stale',
  IGNORED_ALREADY_PAID: 'ignored_already_paid',
  IGNORED_TERMINAL: 'ignored_terminal',
  CONFLICT: 'conflict',
  REJECTED_AMOUNT: 'rejected_amount',
} as const;

export const WEBHOOK_RESULT_LOG_EVENT: Readonly<Record<WebhookResult, LogEventName>> = {
  [WEBHOOK_RESULT.APPLIED]: LOG_EVENT.PAYMENT_APPLIED,
  [WEBHOOK_RESULT.DUPLICATE]: LOG_EVENT.PAYMENT_DUPLICATE,
  [WEBHOOK_RESULT.ORPHAN]: LOG_EVENT.PAYMENT_ORPHAN,
  [WEBHOOK_RESULT.IGNORED_STALE]: LOG_EVENT.PAYMENT_IGNORED_STALE,
  [WEBHOOK_RESULT.IGNORED_ALREADY_PAID]: LOG_EVENT.PAYMENT_IGNORED_TERMINAL,
  [WEBHOOK_RESULT.IGNORED_TERMINAL]: LOG_EVENT.PAYMENT_IGNORED_TERMINAL,
  [WEBHOOK_RESULT.CONFLICT]: LOG_EVENT.PAYMENT_CONFLICT,
  [WEBHOOK_RESULT.REJECTED_AMOUNT]: LOG_EVENT.PAYMENT_AMOUNT_MISMATCH,
};

export const PAYMENT_EVENT_INSERT_SQL = `
  INSERT INTO payment_events (event_id, order_ext_id, status, amount_minor, currency,
                              occurred_at, raw_payload, trace_id, state)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
  ON CONFLICT (event_id) DO NOTHING
  RETURNING id
`;

export const PAYMENT_EVENT_FINALISE_SQL = `
  UPDATE payment_events
  SET state = $2, processed_at = now(), order_id = $3, ignore_reason = $4,
      applied_from_status = $5, applied_to_status = $6
  WHERE id = $1
`;

export const PAYMENT_TRANSITION_LOST_MESSAGE = 'Не удалось применить платёжный переход к заказу';

export const PAYMENT_TRANSACTION_REQUIRED_MESSAGE = 'Обработка платёжного события требует открытой транзакции';

export const PAYMENT_FAILED_REASON = 'Платёж отклонён платёжной системой';

export const AMOUNT_MISMATCH_REASON_TEMPLATE =
  'Сумма/валюта платежа не совпадают с заказом: ожидалось %s %s, получено %s %s';

export const STALE_EVENT_REASON_TEMPLATE =
  'Событие устарело: occurred_at %s раньше последнего применённого события %s';

export const IGNORED_EVENT_REASON_TEMPLATE = 'Событие проигнорировано: заказ уже в статусе %s, событие %s — noop';

export const CONFLICT_EVENT_REASON_TEMPLATE =
  'Конфликт: заказ в статусе %s, входящее событие %s противоречит текущему состоянию';

// sweeper pass 6a: orphan-события, для которых заказ уже появился — идёт через idx_payment_events_orphan
export const PAYMENT_FIND_REPLAYABLE_ORPHANS_SQL = `
  SELECT pe.id, pe.event_id, pe.order_ext_id, pe.status, pe.amount_minor, pe.currency,
         pe.occurred_at, pe.raw_payload, pe.trace_id
  FROM payment_events pe
  JOIN orders o ON o.ext_id = pe.order_ext_id
  WHERE pe.state = 'orphan'
  ORDER BY pe.received_at
  FOR UPDATE OF pe SKIP LOCKED
  LIMIT $1
`;

// sweeper pass 6b: orphan-события старше orphanTtlSeconds без заказа — абандон
export const PAYMENT_FIND_ABANDONABLE_ORPHANS_SQL = `
  SELECT id FROM payment_events
  WHERE state = 'orphan' AND received_at < now() - ($1 || ' seconds')::interval
  ORDER BY received_at
  FOR UPDATE SKIP LOCKED
  LIMIT $2
`;

export const ORPHAN_ABANDONED_REASON = 'sweeper: orphan ttl exceeded, order never appeared';
