import * as fs from 'node:fs';

import type { Client } from 'pg';

import { connectClient, toSafeInt, withTransaction } from './lib/db';
import { intEnv, loadDotEnv, requireEnv } from './lib/env';
import {
  DATABASE_URL_VAR,
  DEFAULT_SUPPLIER_VIRTUAL_STOCK,
  INVALID_FILE_MESSAGE,
  INVALID_PRODUCT_MESSAGE,
  KEYS_FILE,
  KEY_DISTRIBUTION,
  MINOR_UNITS_PER_MAJOR,
  MISSING_KEY_SLICE_MESSAGE,
  MIN_SUPPLIER_VIRTUAL_STOCK,
  PRODUCTS_FILE,
  SEED_BATCH,
  SEED_DONE_MESSAGE,
  SEED_FULFILLMENT_MODE,
  SEED_IN_STOCK_SYNC_SQL,
  SEED_KEYS_INSERT_SQL,
  SEED_PRODUCT_TYPE,
  SEED_POST_COMMIT_FAILED_MESSAGE,
  SEED_PRODUCT_UPSERT_SQL,
  SEED_ROLLED_BACK_MESSAGE,
  SEED_SKU_STOCK_POOL_SQL,
  SEED_SKU_STOCK_SUPPLIER_SQL,
  SEED_VERIFY_SQL,
  SUMMARY_HEADER,
  SUMMARY_MODE_WIDTH,
  SUMMARY_NUMBER_WIDTH,
  SUMMARY_SKU_WIDTH,
  SUPPLIER_VIRTUAL_STOCK_VAR,
  UPSERT_FAILED_MESSAGE,
  VERIFY_KEY_COUNT_MESSAGE,
  VERIFY_PRODUCT_COUNT_MESSAGE,
} from './seed-catalog.constants';
import type { IKeysFile, IProductSeed, IProductsFile, ISeedSummary, ISeedVerifyRow } from './seed-catalog.interfaces';
import type { SeedFulfillmentMode, SeedProductType } from './seed-catalog.type';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readJsonFile(file: string): unknown {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
}

function isProductType(value: unknown): value is SeedProductType {
  return Object.values(SEED_PRODUCT_TYPE).some((known) => known === value);
}

function toProductSeed(entry: unknown, index: number): IProductSeed {
  if (
    !isRecord(entry) ||
    typeof entry.sku !== 'string' ||
    typeof entry.name !== 'string' ||
    !isProductType(entry.type) ||
    typeof entry.price !== 'number' ||
    typeof entry.currency !== 'string'
  ) {
    throw new Error(`${INVALID_PRODUCT_MESSAGE}: ${PRODUCTS_FILE}[${index}]`);
  }

  return {
    sku: entry.sku,
    name: entry.name,
    type: entry.type,
    price: entry.price,
    currency: entry.currency,
    image: typeof entry.image === 'string' ? entry.image : null,
  };
}

function readProductsFile(): IProductsFile {
  const parsed = readJsonFile(PRODUCTS_FILE);

  if (!isRecord(parsed) || !Array.isArray(parsed.products)) {
    throw new Error(`${INVALID_FILE_MESSAGE}: ${PRODUCTS_FILE}`);
  }

  return { products: parsed.products.map((entry: unknown, index: number) => toProductSeed(entry, index)) };
}

function readKeysFile(): IKeysFile {
  const parsed = readJsonFile(KEYS_FILE);

  if (!isRecord(parsed) || !Array.isArray(parsed.keys) || parsed.keys.some((code: unknown) => typeof code !== 'string')) {
    throw new Error(`${INVALID_FILE_MESSAGE}: ${KEYS_FILE}`);
  }

  return { keys: parsed.keys as string[] };
}

function keysForSku(sku: string, keys: string[]): string[] {
  let offset = 0;

  for (const slice of KEY_DISTRIBUTION) {
    if (slice.sku === sku) {
      return keys.slice(offset, offset + slice.count);
    }

    offset += slice.count;
  }

  throw new Error(`${MISSING_KEY_SLICE_MESSAGE}: ${sku}`);
}

function fulfillmentModeFor(type: SeedProductType): SeedFulfillmentMode {
  return type === SEED_PRODUCT_TYPE.KEY ? SEED_FULFILLMENT_MODE.POOL : SEED_FULFILLMENT_MODE.SUPPLIER;
}

async function upsertProduct(client: Client, product: IProductSeed, mode: SeedFulfillmentMode): Promise<number> {
  const priceMinor = toSafeInt(product.price * MINOR_UNITS_PER_MAJOR, `${product.sku}.price_minor`);
  const result = await client.query<{ id: string }>(SEED_PRODUCT_UPSERT_SQL, [
    product.sku,
    product.name,
    product.type,
    priceMinor,
    product.currency,
    product.image,
    mode,
  ]);
  const row = result.rows[0];

  if (row === undefined) {
    throw new Error(`${UPSERT_FAILED_MESSAGE}: ${product.sku}`);
  }

  return toSafeInt(row.id, `${product.sku}.id`);
}

async function insertKeys(client: Client, productId: number, codes: string[]): Promise<void> {
  await client.query(SEED_KEYS_INSERT_SQL, [productId, codes, SEED_BATCH]);
}

async function upsertStock(client: Client, productId: number, mode: SeedFulfillmentMode, virtualStock: number): Promise<void> {
  if (mode === SEED_FULFILLMENT_MODE.POOL) {
    await client.query(SEED_SKU_STOCK_POOL_SQL, [productId]);

    return;
  }

  await client.query(SEED_SKU_STOCK_SUPPLIER_SQL, [productId, virtualStock]);
}

async function seedProduct(client: Client, product: IProductSeed, keys: string[], virtualStock: number): Promise<void> {
  const mode = fulfillmentModeFor(product.type);
  const productId = await upsertProduct(client, product, mode);

  if (mode === SEED_FULFILLMENT_MODE.POOL) {
    await insertKeys(client, productId, keysForSku(product.sku, keys));
  }

  await upsertStock(client, productId, mode, virtualStock);
}

async function verify(client: Client, products: IProductSeed[]): Promise<ISeedVerifyRow[]> {
  const skus = products.map((product) => product.sku);
  const result = await client.query<ISeedVerifyRow>(SEED_VERIFY_SQL, [skus]);

  if (result.rows.length !== products.length) {
    throw new Error(`${VERIFY_PRODUCT_COUNT_MESSAGE}: ожидалось ${products.length}, получено ${result.rows.length}`);
  }

  for (const slice of KEY_DISTRIBUTION) {
    const row = result.rows.find((candidate) => candidate.sku === slice.sku);

    if (row === undefined || row.key_count !== slice.count) {
      throw new Error(`${VERIFY_KEY_COUNT_MESSAGE}: ${slice.sku}`);
    }
  }

  return result.rows;
}

function buildSummary(rows: ISeedVerifyRow[]): ISeedSummary {
  return {
    products: rows.length,
    keys: rows.reduce((total, row) => total + row.key_count, 0),
    pool: rows.filter((row) => row.fulfillment_mode === SEED_FULFILLMENT_MODE.POOL).length,
    supplier: rows.filter((row) => row.fulfillment_mode === SEED_FULFILLMENT_MODE.SUPPLIER).length,
  };
}

function formatRow(row: ISeedVerifyRow): string {
  return [
    row.sku.padEnd(SUMMARY_SKU_WIDTH),
    row.fulfillment_mode.padEnd(SUMMARY_MODE_WIDTH),
    row.price_minor.padStart(SUMMARY_NUMBER_WIDTH),
    String(row.available_count).padStart(SUMMARY_NUMBER_WIDTH),
    String(row.key_count).padStart(SUMMARY_NUMBER_WIDTH),
  ].join(' ');
}

function printSummary(rows: ISeedVerifyRow[]): void {
  const summary = buildSummary(rows);

  console.log(SUMMARY_HEADER);

  for (const row of rows) {
    console.log(formatRow(row));
  }

  console.log(
    `${SEED_DONE_MESSAGE}: товаров ${summary.products} (пул ${summary.pool}, поставщик ${summary.supplier}), ключей ${summary.keys}.`,
  );
}

function reportFailure(error: unknown, committed: boolean): void {
  const header = committed ? SEED_POST_COMMIT_FAILED_MESSAGE : SEED_ROLLED_BACK_MESSAGE;

  console.error(header, error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

async function endQuietly(client: Client): Promise<void> {
  try {
    await client.end();
  } catch {
    // сбой закрытия соединения не меняет судьбу уже завершённой транзакции
  }
}

async function main(): Promise<void> {
  loadDotEnv();

  const databaseUrl = requireEnv(DATABASE_URL_VAR);
  const virtualStock = intEnv(SUPPLIER_VIRTUAL_STOCK_VAR, DEFAULT_SUPPLIER_VIRTUAL_STOCK, MIN_SUPPLIER_VIRTUAL_STOCK);
  const productsFile = readProductsFile();
  const keysFile = readKeysFile();
  const client = await connectClient(databaseUrl);
  let committed = false;

  try {
    await withTransaction(client, async () => {
      for (const product of productsFile.products) {
        await seedProduct(client, product, keysFile.keys, virtualStock);
      }

      await client.query(SEED_IN_STOCK_SYNC_SQL);
    });

    committed = true;

    printSummary(await verify(client, productsFile.products));
  } catch (error: unknown) {
    reportFailure(error, committed);
  } finally {
    await endQuietly(client);
  }
}

main().catch((error: unknown) => {
  reportFailure(error, false);
});
