import type { IJsonLoggerOptions } from './logging.interfaces';
import type { LogEventName, LogLevel } from './logging.type';

export const JSON_LOGGER: unique symbol = Symbol('JSON_LOGGER');

export const LOG_LEVEL_SEVERITY: Readonly<Record<LogLevel, number>> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const NEST_LEVEL_MAP: Readonly<Record<string, LogLevel>> = {
  verbose: 'debug',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'error',
};

export const TRACE_ID_HEADER = 'x-request-id';

export const MAX_TRACE_ID_LENGTH = 200;

export const TRACE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

export const ACCESS_LOG_SILENT_PATHS = ['/health', '/health/ready'];

export const NEST_FRAMEWORK_EVENT = 'app.log';

export const NEST_STACK_PATTERN = /^(.)+\n\s+at .+:\d+:\d+/;

export const CODE_MASK_CHAR = '*';

export const CODE_VISIBLE_PREFIX_LEN = 4;

export const CODE_VISIBLE_SUFFIX_LEN = 2;

export const FALLBACK_LOGGER_OPTIONS: IJsonLoggerOptions = {
  level: 'info',
  format: 'json',
  includeStack: true,
};

export const LOG_EVENT = {
  ORDER_CREATED: 'order.created',
  PAYMENT_RECEIVED: 'payment.received',
  PAYMENT_APPLIED: 'payment.applied',
  DELIVERY_ENQUEUED: 'delivery.enqueued',
  DELIVERY_STARTED: 'delivery.started',
  DELIVERY_ATTEMPT_CREATED: 'delivery.attempt.created',
  DELIVERY_ATTEMPT_SUCCEEDED: 'delivery.attempt.succeeded',
  DELIVERY_COMPLETED: 'delivery.completed',
  DELIVERY_OUT_OF_STOCK: 'delivery.out_of_stock',
  JOB_CLAIMED: 'job.claimed',
  JOB_SUCCEEDED: 'job.succeeded',
  LEDGER_TXN_POSTED: 'ledger.txn_posted',
  SWEEPER_CYCLE: 'sweeper.cycle',
  RECONCILE_CYCLE: 'reconcile.cycle',
  PAYMENT_DUPLICATE: 'payment.duplicate',
  PAYMENT_ORPHAN: 'payment.orphan',
  PAYMENT_IGNORED_STALE: 'payment.ignored_stale',
  PAYMENT_IGNORED_TERMINAL: 'payment.ignored_terminal',
  DELIVERY_ATTEMPT_TIMEOUT: 'delivery.attempt.timeout',
  DELIVERY_ATTEMPT_UNKNOWN: 'delivery.attempt.unknown',
  DELIVERY_ATTEMPT_RESOLVING: 'delivery.attempt.resolving',
  DELIVERY_FALLBACK: 'delivery.fallback',
  JOB_RETRY_SCHEDULED: 'job.retry_scheduled',
  SWEEPER_REQUEUED: 'sweeper.requeued',
  RECONCILE_DRIFT_REPAIRED: 'reconcile.drift_repaired',
  DB_SERIALIZATION_RETRY: 'db.serialization_retry',
  STUB_SCENARIO_FORCED: 'stub.scenario_forced',
  PAYMENT_CONFLICT: 'payment.conflict',
  PAYMENT_AMOUNT_MISMATCH: 'payment.amount_mismatch',
  DELIVERY_FAILED: 'delivery.failed',
  DELIVERY_STRANDED_ISSUANCE: 'delivery.stranded_issuance',
  JOB_DEAD: 'job.dead',
  LEDGER_IMBALANCE_DETECTED: 'ledger.imbalance_detected',
  ATTEMPT_INFLIGHT_EXPIRED: 'attempt.inflight_expired',
  SUPPLIER_REQUEST: 'supplier.request',
  SUPPLIER_RESPONSE: 'supplier.response',
  CATALOG_QUERY: 'catalog.query',
  APP_STARTED: 'app.started',
  APP_BOOT_FAILED: 'app.boot_failed',
  APP_UNCAUGHT_EXCEPTION: 'app.uncaught_exception',
  APP_UNHANDLED_REJECTION: 'app.unhandled_rejection',
  HTTP_REQUEST: 'http.request',
  HTTP_ERROR: 'http.error',
  DB_CONNECTED: 'db.connected',
} as const;

export const LOG_EVENT_LEVEL: Readonly<Record<LogEventName, LogLevel>> = {
  [LOG_EVENT.ORDER_CREATED]: 'info',
  [LOG_EVENT.PAYMENT_RECEIVED]: 'info',
  [LOG_EVENT.PAYMENT_APPLIED]: 'info',
  [LOG_EVENT.DELIVERY_ENQUEUED]: 'info',
  [LOG_EVENT.DELIVERY_STARTED]: 'info',
  [LOG_EVENT.DELIVERY_ATTEMPT_CREATED]: 'info',
  [LOG_EVENT.DELIVERY_ATTEMPT_SUCCEEDED]: 'info',
  [LOG_EVENT.DELIVERY_COMPLETED]: 'info',
  [LOG_EVENT.DELIVERY_OUT_OF_STOCK]: 'info',
  [LOG_EVENT.JOB_CLAIMED]: 'info',
  [LOG_EVENT.JOB_SUCCEEDED]: 'info',
  [LOG_EVENT.LEDGER_TXN_POSTED]: 'info',
  [LOG_EVENT.SWEEPER_CYCLE]: 'info',
  [LOG_EVENT.RECONCILE_CYCLE]: 'info',
  [LOG_EVENT.PAYMENT_DUPLICATE]: 'warn',
  [LOG_EVENT.PAYMENT_ORPHAN]: 'warn',
  [LOG_EVENT.PAYMENT_IGNORED_STALE]: 'warn',
  [LOG_EVENT.PAYMENT_IGNORED_TERMINAL]: 'warn',
  [LOG_EVENT.DELIVERY_ATTEMPT_TIMEOUT]: 'warn',
  [LOG_EVENT.DELIVERY_ATTEMPT_UNKNOWN]: 'warn',
  [LOG_EVENT.DELIVERY_ATTEMPT_RESOLVING]: 'warn',
  [LOG_EVENT.DELIVERY_FALLBACK]: 'warn',
  [LOG_EVENT.JOB_RETRY_SCHEDULED]: 'warn',
  [LOG_EVENT.SWEEPER_REQUEUED]: 'warn',
  [LOG_EVENT.RECONCILE_DRIFT_REPAIRED]: 'warn',
  [LOG_EVENT.DB_SERIALIZATION_RETRY]: 'warn',
  [LOG_EVENT.STUB_SCENARIO_FORCED]: 'warn',
  [LOG_EVENT.PAYMENT_CONFLICT]: 'error',
  [LOG_EVENT.PAYMENT_AMOUNT_MISMATCH]: 'error',
  [LOG_EVENT.DELIVERY_FAILED]: 'error',
  [LOG_EVENT.DELIVERY_STRANDED_ISSUANCE]: 'error',
  [LOG_EVENT.JOB_DEAD]: 'error',
  [LOG_EVENT.LEDGER_IMBALANCE_DETECTED]: 'error',
  [LOG_EVENT.ATTEMPT_INFLIGHT_EXPIRED]: 'error',
  [LOG_EVENT.SUPPLIER_REQUEST]: 'debug',
  [LOG_EVENT.SUPPLIER_RESPONSE]: 'debug',
  [LOG_EVENT.CATALOG_QUERY]: 'debug',
  [LOG_EVENT.APP_STARTED]: 'info',
  [LOG_EVENT.APP_BOOT_FAILED]: 'error',
  [LOG_EVENT.APP_UNCAUGHT_EXCEPTION]: 'error',
  [LOG_EVENT.APP_UNHANDLED_REJECTION]: 'error',
  [LOG_EVENT.HTTP_REQUEST]: 'info',
  [LOG_EVENT.HTTP_ERROR]: 'error',
  [LOG_EVENT.DB_CONNECTED]: 'info',
};
