import type { LogFormat, LogLevel } from '../logging/logging.type';
import type { IEnvIssue } from './config.interfaces';

export type NodeEnvName = 'development' | 'test' | 'production';

export type EnvRaw = Record<string, unknown>;

export type EnvVarKind = 'string' | 'int' | 'bool' | 'enum' | 'url';

export interface AppEnv {
  NODE_ENV: NodeEnvName;
  PORT: number;
  DATABASE_URL: string;
  DB_POOL_SIZE: number;
  DB_STATEMENT_TIMEOUT_MS: number;
  DB_LOCK_TIMEOUT_MS: number;
  DB_TX_RETRY_ATTEMPTS: number;
  LOG_LEVEL: LogLevel;
  LOG_FORMAT: LogFormat;
  LOG_STACK: boolean;
  SUPPLIER_A_BASE_URL: string;
  SUPPLIER_B_BASE_URL: string;
  SUPPLIER_REQUEST_TIMEOUT_MS: number;
  SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER: number;
  SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS: number;
  SUPPLIER_RETRY_BASE_MS: number;
  SUPPLIER_RETRY_MAX_MS: number;
  SUPPLIER_JOB_BUDGET_MS: number;
  SUPPLIER_VIRTUAL_STOCK: number;
  WORKER_ENABLED: boolean;
  WORKER_ID: string;
  JOB_POLL_INTERVAL_MS: number;
  JOB_BATCH_SIZE: number;
  JOB_MAX_ATTEMPTS: number;
  JOB_RETRY_BASE_MS: number;
  JOB_RETRY_MAX_MS: number;
  JOB_LOCK_TTL_MS: number;
  SWEEPER_ENABLED: boolean;
  SWEEPER_INTERVAL_MS: number;
  SWEEPER_BATCH_SIZE: number;
  STUCK_ORDER_AGE_SECONDS: number;
  DELIVERY_FAILED_RETRY_SECONDS: number;
  MAX_DELIVERY_GENERATIONS: number;
  ATTEMPT_INFLIGHT_TIMEOUT_MS: number;
  ORPHAN_TTL_SECONDS: number;
  STOCK_RECONCILE_INTERVAL_MS: number;
  ADMIN_API_ENABLED: boolean;
  ADMIN_TOKEN: string;
  CATALOG_DEFAULT_LIMIT: number;
  CATALOG_MAX_LIMIT: number;
}

export type EnvVarName = keyof AppEnv;

export type EnvCrossRuleCheck = (env: AppEnv) => IEnvIssue | null;
