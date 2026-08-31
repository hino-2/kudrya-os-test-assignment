import type { DataSource } from 'typeorm';

import { RESET_DATABASE_SQL, RESET_ORDER_SEQUENCE_SQL } from './harness.constants';

export async function resetDatabase(ds: DataSource): Promise<void> {
  await ds.query(RESET_DATABASE_SQL);
  await ds.query(RESET_ORDER_SEQUENCE_SQL);
}
