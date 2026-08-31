import type { PostgresDataSourceOptions } from 'typeorm/driver/postgres/PostgresDataSourceOptions';

import type { IDbConfig } from '../config/config.interfaces';
import { DB_APPLICATION_NAME, ENTITIES, MIGRATIONS, MIGRATIONS_TABLE_NAME } from './db.constants';
import type { IDataSourceSeams } from './db.interfaces';

export function buildDataSourceOptions(db: IDbConfig, seams?: IDataSourceSeams): PostgresDataSourceOptions {
  return {
    type: 'postgres',
    url: db.url,
    poolSize: db.poolSize,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: MIGRATIONS_TABLE_NAME,
    logging: false,
    entities: seams?.entities ?? ENTITIES,
    migrations: seams?.migrations ?? MIGRATIONS,
    extra: {
      statement_timeout: db.statementTimeoutMs,
      lock_timeout: db.lockTimeoutMs,
      application_name: DB_APPLICATION_NAME,
    },
  };
}
