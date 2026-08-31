import { createTestDataSource } from './db.harness';
import { applyTestEnv } from './test-env.helper';

export default async function setup(): Promise<void> {
  const dataSource = createTestDataSource(applyTestEnv());

  await dataSource.initialize();

  try {
    await dataSource.runMigrations();
  } finally {
    await dataSource.destroy();
  }
}
