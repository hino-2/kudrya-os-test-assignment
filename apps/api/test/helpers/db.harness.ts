import 'reflect-metadata';

import { DataSource } from 'typeorm';

import { MIGRATIONS, MIGRATIONS_TABLE_NAME } from '../../src/common/db/db.constants';
import { registerPgTypeParsers } from '../../src/common/db/pg-types.util';
import type { IDbHarness } from './harness.interfaces';
import { applyTestEnv } from './test-env.helper';

export function createTestDataSource(url: string): DataSource {
  registerPgTypeParsers();

  return new DataSource({
    type: 'postgres',
    url,
    synchronize: false,
    migrationsRun: false,
    migrationsTableName: MIGRATIONS_TABLE_NAME,
    logging: false,
    entities: [],
    migrations: MIGRATIONS,
  });
}

export async function startDb(): Promise<IDbHarness> {
  const dataSource = createTestDataSource(applyTestEnv());

  await dataSource.initialize();

  return { dataSource, stop: () => dataSource.destroy() };
}
