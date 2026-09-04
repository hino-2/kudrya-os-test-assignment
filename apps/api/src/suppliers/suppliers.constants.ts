export const SUPPLIER_CODE = {
  A: 'A',
  B: 'B',
} as const;

// порядок фолбэка A→B: пока поставщик A не исчерпан (см. supplier-plan.util), переход к B
// происходит только при исходах, доказанно не выдавших код (см. isDefinitiveOutcome)
export const FALLBACK_CHAIN = [SUPPLIER_CODE.A, SUPPLIER_CODE.B] as const;

export const SUPPLIER_OUTCOME = {
  ISSUED: 'issued',
  OUT_OF_STOCK: 'out_of_stock',
  REJECTED: 'rejected',
  UNAVAILABLE: 'unavailable',
  UNKNOWN: 'unknown',
} as const;

export const SUPPLIER_ERROR_KIND = {
  TIMEOUT: 'timeout',
  CONNECTION_REFUSED: 'connection_refused',
  CONNECTION_RESET: 'connection_reset',
  HTTP_4XX: 'http_4xx',
  HTTP_5XX: 'http_5xx',
  OUT_OF_STOCK: 'out_of_stock',
  BAD_BODY: 'bad_body',
  INFLIGHT_EXPIRED: 'inflight_expired',
} as const;

export const SUPPLIER_ISSUE_PATH = '/issue';

export const SUPPLIER_CONTROL_RESTOCK_PATH = '/_control/restock';

export const SUPPLIER_REQUEST_ID_PREFIX = 'req_';

export const SUPPLIER_ORDER_EXT_PREFIX = 'ord_';

export const SUPPLIER_REQUEST_ID_SEPARATOR = '-';

export const SUPPLIER_GENERATION_MARKER = 'g';

export const SUPPLIER_OK_STATUS = 'ok';

export const SUPPLIER_ERROR_STATUS = 'error';

export const SUPPLIER_OUT_OF_STOCK_REASON = 'out_of_stock';

export const SUPPLIER_CONTENT_TYPE = 'application/json';

export const SUPPLIER_TIMEOUT_ERROR_NAMES = ['TimeoutError', 'AbortError'] as const;

// EACCES on connect(): OS refused the local socket before any bytes left the machine (Windows
// hits this under Hyper-V/WSL ephemeral-port exclusion) — same never-reached-supplier guarantee
// as ECONNREFUSED, so it belongs in the definitive-refusal bucket, not the ambiguous unknown one.
export const SUPPLIER_REFUSED_CODES = ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EACCES'] as const;

export const SUPPLIER_RESET_CODES = ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE'] as const;

export const HTTP_STATUS_SERVER_ERROR_MIN = 500;

export const HTTP_STATUS_CLIENT_ERROR_MIN = 400;

export const UNKNOWN_SUPPLIER_CODE_MESSAGE_TEMPLATE = 'Неизвестный код поставщика: %s';

export const SUPPLIER_MISSING_ERROR_KIND_MESSAGE = 'У неуспешного исхода поставщика отсутствует error_kind — нарушение контракта supplier.client';
