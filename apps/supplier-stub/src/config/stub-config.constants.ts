import type { SupplierId } from './stub-config.type';

export const STUB_CONFIG_ENV_DEFAULTS = {
  SUPPLIER_ID: 'A',
  PORT: 4001,
  STUB_INVENTORY_SIZE: 100,
  STUB_FAIL_RATE: 0.2,
  STUB_TIMEOUT_RATE: 0.2,
  STUB_SLOW_RATE: 0.3,
  STUB_LATENCY_MS_MIN: 500,
  STUB_LATENCY_MS_MAX: 1500,
  STUB_HANG_MS: 6000,
  STUB_CONTROL_ENABLED: true,
  LOG_LEVEL: 'info',
  LOG_FORMAT: 'json',
} as const;

// XXXX-XXXX-XXXX codes, alphabet excludes ambiguous chars 0/O/1/I.
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const CODE_GROUP_LENGTH = 4;

export const CODE_GROUP_COUNT = 3;

export const CODE_SEPARATOR = '-';

export const STUB_ERROR_CODE = {
  BAD_REQUEST: 'sku_unknown',
  OUT_OF_STOCK: 'out_of_stock',
  UPSTREAM_UNAVAILABLE: 'upstream_unavailable',
  NOT_FOUND: 'not_found',
} as const;

export const GARBAGE_BODY = '<html><body>upstream error, not JSON</body></html>';

export const CONFIG_ERROR_HEADER = 'Некорректная конфигурация окружения supplier-stub';

export const RATE_MIN = 0;

export const RATE_MAX = 1;

export const SUPPLIER_IDS: readonly SupplierId[] = ['A', 'B'];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

export const LOG_FORMATS = ['json', 'pretty'];

export const BOOL_TRUE_VALUES = ['true', '1', 'yes'];

export const BOOL_FALSE_VALUES = ['false', '0', 'no'];
