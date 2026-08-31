import type { IEnvCrossRule, IEnvVarSpec } from './config.interfaces';

export const ENV_FILE_PATHS = ['.env', '../../.env'] as const;

export const CONFIG_ERROR_HEADER = 'Некорректная конфигурация окружения';

export const ENV_SPEC: readonly IEnvVarSpec[] = [
  { name: 'NODE_ENV', kind: 'enum', default: 'development', values: ['development', 'test', 'production'] },
  { name: 'PORT', kind: 'int', default: 3000, min: 1, max: 65535 },
  { name: 'DATABASE_URL', kind: 'url', required: true, protocols: ['postgres:', 'postgresql:'] },
  { name: 'DB_POOL_SIZE', kind: 'int', default: 20, min: 1, max: 100 },
  { name: 'DB_STATEMENT_TIMEOUT_MS', kind: 'int', default: 10000, min: 0, max: 600000 },
  { name: 'DB_LOCK_TIMEOUT_MS', kind: 'int', default: 5000, min: 0, max: 600000 },
  { name: 'DB_TX_RETRY_ATTEMPTS', kind: 'int', default: 3, min: 0, max: 10 },
  { name: 'LOG_LEVEL', kind: 'enum', default: 'info', values: ['debug', 'info', 'warn', 'error'] },
  { name: 'LOG_FORMAT', kind: 'enum', default: 'json', values: ['json', 'pretty'] },
  { name: 'LOG_STACK', kind: 'bool', default: false },
  { name: 'SUPPLIER_A_BASE_URL', kind: 'url', default: 'http://localhost:4001', protocols: ['http:', 'https:'] },
  { name: 'SUPPLIER_B_BASE_URL', kind: 'url', default: 'http://localhost:4002', protocols: ['http:', 'https:'] },
  { name: 'SUPPLIER_REQUEST_TIMEOUT_MS', kind: 'int', default: 2000, min: 100, max: 30000 },
  { name: 'SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER', kind: 'int', default: 2, min: 1, max: 5 },
  { name: 'SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS', kind: 'int', default: 5, min: 1, max: 10 },
  { name: 'SUPPLIER_RETRY_BASE_MS', kind: 'int', default: 200, min: 0, max: 60000 },
  { name: 'SUPPLIER_RETRY_MAX_MS', kind: 'int', default: 2000, min: 0, max: 60000 },
  { name: 'SUPPLIER_JOB_BUDGET_MS', kind: 'int', default: 10000, min: 100, max: 600000 },
  { name: 'SUPPLIER_VIRTUAL_STOCK', kind: 'int', default: 1000, min: 0, max: 1000000 },
  { name: 'WORKER_ENABLED', kind: 'bool', default: true },
  { name: 'WORKER_ID', kind: 'string', allowEmpty: true },
  { name: 'JOB_POLL_INTERVAL_MS', kind: 'int', default: 200, min: 20, max: 60000 },
  { name: 'JOB_BATCH_SIZE', kind: 'int', default: 5, min: 1, max: 100 },
  { name: 'JOB_MAX_ATTEMPTS', kind: 'int', default: 8, min: 1, max: 20 },
  { name: 'JOB_RETRY_BASE_MS', kind: 'int', default: 500, min: 0, max: 600000 },
  { name: 'JOB_RETRY_MAX_MS', kind: 'int', default: 30000, min: 0, max: 600000 },
  { name: 'JOB_LOCK_TTL_MS', kind: 'int', default: 120000, min: 1000, max: 3600000 },
  { name: 'SWEEPER_ENABLED', kind: 'bool', default: true },
  { name: 'SWEEPER_INTERVAL_MS', kind: 'int', default: 15000, min: 100, max: 3600000 },
  { name: 'SWEEPER_BATCH_SIZE', kind: 'int', default: 100, min: 1, max: 1000 },
  { name: 'STUCK_ORDER_AGE_SECONDS', kind: 'int', default: 60, min: 1, max: 86400 },
  { name: 'DELIVERY_FAILED_RETRY_SECONDS', kind: 'int', default: 300, min: 1, max: 86400 },
  { name: 'MAX_DELIVERY_GENERATIONS', kind: 'int', default: 5, min: 1, max: 50 },
  { name: 'ATTEMPT_INFLIGHT_TIMEOUT_MS', kind: 'int', default: 30000, min: 1000, max: 600000 },
  { name: 'ORPHAN_TTL_SECONDS', kind: 'int', default: 3600, min: 1, max: 604800 },
  { name: 'STOCK_RECONCILE_INTERVAL_MS', kind: 'int', default: 60000, min: 1000, max: 3600000 },
  { name: 'ADMIN_API_ENABLED', kind: 'bool', default: true },
  { name: 'ADMIN_TOKEN', kind: 'string', default: 'dev-admin-token', allowEmpty: true },
  { name: 'CATALOG_DEFAULT_LIMIT', kind: 'int', default: 24, min: 1, max: 100 },
  { name: 'CATALOG_MAX_LIMIT', kind: 'int', default: 100, min: 1, max: 1000 },
] as const;

export const ENV_CROSS_RULES: readonly IEnvCrossRule[] = [
  {
    fields: ['CATALOG_DEFAULT_LIMIT', 'CATALOG_MAX_LIMIT'],
    check: (env) =>
      env.CATALOG_DEFAULT_LIMIT <= env.CATALOG_MAX_LIMIT
        ? null
        : {
            name: 'CATALOG_DEFAULT_LIMIT',
            reason: 'CATALOG_DEFAULT_LIMIT не может превышать CATALOG_MAX_LIMIT',
          },
  },
  {
    fields: ['SUPPLIER_RETRY_BASE_MS', 'SUPPLIER_RETRY_MAX_MS'],
    check: (env) =>
      env.SUPPLIER_RETRY_BASE_MS <= env.SUPPLIER_RETRY_MAX_MS
        ? null
        : {
            name: 'SUPPLIER_RETRY_BASE_MS',
            reason: 'SUPPLIER_RETRY_BASE_MS не может превышать SUPPLIER_RETRY_MAX_MS',
          },
  },
  {
    fields: ['JOB_RETRY_BASE_MS', 'JOB_RETRY_MAX_MS'],
    check: (env) =>
      env.JOB_RETRY_BASE_MS <= env.JOB_RETRY_MAX_MS
        ? null
        : {
            name: 'JOB_RETRY_BASE_MS',
            reason: 'JOB_RETRY_BASE_MS не может превышать JOB_RETRY_MAX_MS',
          },
  },
];
