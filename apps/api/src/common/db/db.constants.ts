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

export const RETRYABLE_TX_ERROR_CODES = [PG_ERROR_CODE.SERIALIZATION_FAILURE, PG_ERROR_CODE.DEADLOCK_DETECTED] as const;

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
];

export const MIGRATIONS_TABLE_NAME = 'migrations';
