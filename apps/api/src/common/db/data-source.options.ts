import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

import type { IDbConfig } from '../config/config.interfaces';
import {
  DB_APPLICATION_NAME,
  DB_CONNECTION_TIMEOUT_MS,
  ENTITIES,
  MIGRATIONS,
  MIGRATIONS_TABLE_NAME,
} from './db.constants';
import type { IDataSourceSeams } from './db.interfaces';

export function buildDataSourceOptions(
  db: IDbConfig,
  seams?: IDataSourceSeams,
): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    url: db.url,
    poolSize: db.poolSize,
    synchronize: false,
    migrationsRun: false,
    // закреплено явно, хотя это и дефолт TypeORM: на одной транзакции для всех миграций держится
    // весь расчёт поведения при потере advisory-лока (см. migrate.ts). Если лок сняли посреди
    // прогона и вторая реплика начала свой, при 'all' проигравшая сторона откатывается целиком и
    // падает на первом же DDL — схема не может остаться на промежуточной ревизии. Переключение на
    // 'each' тихо меняет этот класс отказа на полу-применённую схему, поэтому значение не должно
    // приезжать из дефолта библиотеки
    migrationsTransactionMode: 'all',
    migrationsTableName: MIGRATIONS_TABLE_NAME,
    logging: false,
    entities: seams?.entities ?? ENTITIES,
    migrations: seams?.migrations ?? MIGRATIONS,
    extra: {
      statement_timeout: db.statementTimeoutMs,
      lock_timeout: db.lockTimeoutMs,
      connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
      application_name: DB_APPLICATION_NAME,
    },
  };
}
