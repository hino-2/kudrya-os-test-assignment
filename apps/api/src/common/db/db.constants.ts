import type { MixedList } from 'typeorm';

import { ProductEntity } from '../../catalog/entities/product.entity';
import { SkuStockEntity } from '../../catalog/entities/sku-stock.entity';
import { DeliveryAttemptEntity } from '../../delivery/entities/delivery-attempt.entity';
import { IssuedDeliveryEntity } from '../../delivery/entities/issued-delivery.entity';
import { StockKeyEntity } from '../../inventory/entities/stock-key.entity';
import { JobEntity } from '../../jobs/entities/job.entity';
import { LedgerEntryEntity } from '../../ledger/entities/ledger-entry.entity';
import { LedgerTxnEntity } from '../../ledger/entities/ledger-txn.entity';
import { InitCore1756600000001 } from '../../migrations/1756600000001-InitCore';
import { InitPayments1756600000002 } from '../../migrations/1756600000002-InitPayments';
import { InitDelivery1756600000003 } from '../../migrations/1756600000003-InitDelivery';
import { InitJobs1756600000004 } from '../../migrations/1756600000004-InitJobs';
import { AddAttemptGeneration1756600000005 } from '../../migrations/1756600000005-AddAttemptGeneration';
import { PriceMinorGranularity1756600000006 } from '../../migrations/1756600000006-PriceMinorGranularity';
import { OrderEntity } from '../../orders/entities/order.entity';
import { PaymentEventEntity } from '../../payments/entities/payment-event.entity';

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

export const RETRYABLE_TX_ERROR_CODES = [
  PG_ERROR_CODE.SERIALIZATION_FAILURE,
  PG_ERROR_CODE.DEADLOCK_DETECTED,
] as const;

export const ISOLATION_LEVEL = 'READ COMMITTED' as const;

export const TX_RETRY_BASE_DELAY_MS = 20;

export const TX_RETRY_JITTER_MS = 10;

export const BIGINT_OID = 20;

export const DB_CONNECT_RETRY_ATTEMPTS = 5;

export const DB_CONNECT_RETRY_DELAY_MS = 1000;

export const DB_APPLICATION_NAME = 'store-api';

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- зеркалит сигнатуру MixedList<Function> из typeorm
export const ENTITIES: MixedList<Function> = [
  ProductEntity,
  SkuStockEntity,
  StockKeyEntity,
  OrderEntity,
  PaymentEventEntity,
  LedgerTxnEntity,
  LedgerEntryEntity,
  DeliveryAttemptEntity,
  IssuedDeliveryEntity,
  JobEntity,
];

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type -- зеркалит сигнатуру MixedList<Function> из typeorm
export const MIGRATIONS: MixedList<Function> = [
  InitCore1756600000001,
  InitPayments1756600000002,
  InitDelivery1756600000003,
  InitJobs1756600000004,
  AddAttemptGeneration1756600000005,
  PriceMinorGranularity1756600000006,
];

export const MIGRATIONS_TABLE_NAME = 'migrations';

// Ключ advisory-лока миграций: ASCII-код строки "store" (0x73746F7265 = 495874699877).
// Значение выбрано так, чтобы (а) быть стабильным между релизами — иначе лок ничего не
// сериализует, (б) не пересекаться с ключами приложения: их у него нет вовсе, все прикладные
// блокировки идут через FOR UPDATE по строкам. Коллизия возможна только с другим приложением
// в той же БД, которое выберет ровно этот же ключ.
export const MIGRATION_ADVISORY_LOCK_KEY = 0x73746f7265;

// Запас ставится только на сессии лока и ограничивает только ОЖИДАНИЕ самого лока: с
// дефолтными lock_timeout=5s/statement_timeout=10s реплика падала бы вместо того, чтобы
// дождаться чужую миграцию. На сам DDL это не влияет — миграции идут по соединениям пула и
// по-прежнему ограничены statement_timeout из data-source.options.ts (DB_STATEMENT_TIMEOUT_MS,
// по умолчанию 10 с): отдельный оператор длиннее этого порога оборвёт миграцию.
export const MIGRATION_LOCK_TIMEOUT_MS = 120000;

export const MIGRATION_FAILED_MESSAGE = 'Не удалось применить миграции:';

export const MIGRATION_LOCK_SQL = 'SELECT pg_advisory_lock($1)';

export const MIGRATION_SET_LOCK_TIMEOUT_SQL = `SET lock_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`;

export const MIGRATION_SET_STATEMENT_TIMEOUT_SQL = `SET statement_timeout = ${MIGRATION_LOCK_TIMEOUT_MS}`;

export const MIGRATION_LOCK_SESSION_LOST_MESSAGE =
  'Сессия advisory-лока миграций оборвана — лок снят, параллельная реплика могла начать свой прогон:';

export const MIGRATION_DB_URL_MISSING_MESSAGE =
  'В настройках DataSource нет DATABASE_URL — некуда подключать сессию advisory-лока';

// Без него зависший захват соединения ждёт молча и бесконечно (node-pg по умолчанию не
// таймаутит acquire), поэтому любая будущая нехватка соединений превращается в тишину
// вместо диагностируемой ошибки.
export const DB_CONNECTION_TIMEOUT_MS = 10000;
