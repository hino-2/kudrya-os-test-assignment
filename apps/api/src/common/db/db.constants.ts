import type { MixedList } from 'typeorm';

export const PG_ERROR_CODE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
  QUERY_CANCELED: '57014',
} as const;

export const RETRYABLE_TX_ERROR_CODES = [PG_ERROR_CODE.SERIALIZATION_FAILURE, PG_ERROR_CODE.DEADLOCK_DETECTED] as const;

export const ISOLATION_LEVEL = 'READ COMMITTED' as const;

export const TX_RETRY_BASE_DELAY_MS = 20;

export const TX_RETRY_JITTER_MS = 10;

export const BIGINT_OID = 20;

export const DB_CONNECT_RETRY_ATTEMPTS = 5;

export const DB_CONNECT_RETRY_DELAY_MS = 1000;

export const DB_APPLICATION_NAME = 'store-api';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- зеркалит сигнатуру MixedList<Function> из typeorm
export const ENTITIES: MixedList<Function> = [];

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- зеркалит сигнатуру MixedList<Function> из typeorm
export const MIGRATIONS: MixedList<Function> = [];

export const MIGRATIONS_TABLE_NAME = 'migrations';
