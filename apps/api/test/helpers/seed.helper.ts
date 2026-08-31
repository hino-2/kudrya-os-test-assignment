import * as fs from 'node:fs';

import type { DataSource } from 'typeorm';

import { FULFILLMENT_MODE, PRODUCT_TYPE } from '../../src/catalog/catalog.constants';
import { MINOR_UNITS_PER_MAJOR } from '../../src/common/money/money.constants';
import {
  KEYS_FILE,
  PRODUCTS_FILE,
  SEED_BATCH,
  SEED_IN_STOCK_SYNC_SQL,
  SEED_KEYS_INSERT_SQL,
  SEED_KEY_DISTRIBUTION,
  SEED_PRODUCT_UPSERT_SQL,
  SEED_SKU_STOCK_POOL_SQL,
  SEED_SKU_STOCK_SUPPLIER_SQL,
  SEED_UPSERT_FAILED_MESSAGE,
  TEST_SUPPLIER_VIRTUAL_STOCK,
} from './harness.constants';
import type { ISeedProduct } from './harness.interfaces';

function readProducts(): ISeedProduct[] {
  const parsed = JSON.parse(fs.readFileSync(PRODUCTS_FILE, 'utf8')) as { products: ISeedProduct[] };

  return parsed.products;
}

function readKeys(): string[] {
  const parsed = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')) as { keys: string[] };

  return parsed.keys;
}

function keysForSku(sku: string, keys: string[]): string[] {
  let offset = 0;

  for (const slice of SEED_KEY_DISTRIBUTION) {
    if (slice.sku === sku) {
      return keys.slice(offset, offset + slice.count);
    }

    offset += slice.count;
  }

  return [];
}

export async function seedCatalog(ds: DataSource): Promise<void> {
  const products = readProducts();
  const keys = readKeys();

  for (const product of products) {
    const mode = product.type === PRODUCT_TYPE.KEY ? FULFILLMENT_MODE.POOL : FULFILLMENT_MODE.SUPPLIER;
    const rows = await ds.query<{ id: number }[]>(SEED_PRODUCT_UPSERT_SQL, [
      product.sku,
      product.name,
      product.type,
      product.price * MINOR_UNITS_PER_MAJOR,
      product.currency,
      product.image,
      mode,
    ]);
    const row = rows[0];

    if (row === undefined) {
      throw new Error(`${SEED_UPSERT_FAILED_MESSAGE}: ${product.sku}`);
    }

    if (mode === FULFILLMENT_MODE.POOL) {
      await ds.query(SEED_KEYS_INSERT_SQL, [row.id, keysForSku(product.sku, keys), SEED_BATCH]);
      await ds.query(SEED_SKU_STOCK_POOL_SQL, [row.id]);
    } else {
      await ds.query(SEED_SKU_STOCK_SUPPLIER_SQL, [row.id, TEST_SUPPLIER_VIRTUAL_STOCK]);
    }
  }

  await ds.query(SEED_IN_STOCK_SYNC_SQL);
}
