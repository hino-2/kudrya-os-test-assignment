import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { startDb } from '../helpers/db.harness';
import {
  COUNT_KEYS_SQL,
  COUNT_PRODUCTS_SQL,
  KEY_COUNTS_BY_SKU_SQL,
  PRODUCT_SNAPSHOT_SQL,
  SEED_KEY_DISTRIBUTION,
  TEST_SUPPLIER_VIRTUAL_STOCK,
} from '../helpers/harness.constants';
import type { IDbHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';
import { runSeedCatalogCli } from '../helpers/seed-cli.helper';

interface ICountRow {
  count: number;
}

interface ISkuCountRow {
  sku: string;
  count: number;
}

interface ISnapshotRow {
  sku: string;
  type: string;
  fulfillment_mode: string;
  price_minor: number;
  in_stock: boolean;
  is_active: boolean;
  available_count: number;
}

let harness: IDbHarness;

async function countOf(sql: string): Promise<number> {
  const rows = await harness.dataSource.query<ICountRow[]>(sql);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Запрос не вернул строк: ${sql}`);
  }

  return row.count;
}

async function snapshotOf(sku: string): Promise<ISnapshotRow> {
  const rows = await harness.dataSource.query<ISnapshotRow[]>(PRODUCT_SNAPSHOT_SQL, [sku]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Товар ${sku} отсутствует в базе после сида`);
  }

  return row;
}

beforeAll(async () => {
  harness = await startDb();
});

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.dataSource);
});

describe('npm run seed:catalog', () => {
  it('fills an empty catalog and stays idempotent on a second run', async () => {
    const first = await runSeedCatalogCli();

    expect(first.exitCode, first.stderr).toBe(0);
    expect(await countOf(COUNT_PRODUCTS_SQL)).toBe(12);
    expect(await countOf(COUNT_KEYS_SQL)).toBe(50);

    const second = await runSeedCatalogCli();

    expect(second.exitCode, second.stderr).toBe(0);
    expect(await countOf(COUNT_PRODUCTS_SQL)).toBe(12);
    expect(await countOf(COUNT_KEYS_SQL)).toBe(50);
    expect(second.stdout).toBe(first.stdout);
  });

  it('slices the key pool 20/20/10 by sku', async () => {
    await runSeedCatalogCli();

    const rows = await harness.dataSource.query<ISkuCountRow[]>(KEY_COUNTS_BY_SKU_SQL);

    expect(rows).toEqual(
      [...SEED_KEY_DISTRIBUTION].sort((a, b) => (a.sku < b.sku ? -1 : 1)).map((slice) => ({ sku: slice.sku, count: slice.count })),
    );
  });

  it('writes prices in minor units and the derived fulfillment mode', async () => {
    await runSeedCatalogCli();

    expect(await snapshotOf('KEY-GTA5')).toMatchObject({
      type: 'key',
      fulfillment_mode: 'pool',
      price_minor: 199000,
      in_stock: true,
      is_active: true,
      available_count: 20,
    });

    expect(await snapshotOf('STEAM-TOPUP-500')).toMatchObject({
      type: 'topup',
      fulfillment_mode: 'supplier',
      price_minor: 50000,
      in_stock: true,
      available_count: TEST_SUPPLIER_VIRTUAL_STOCK,
    });
  });
});
