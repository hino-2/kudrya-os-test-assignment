import { createRequire } from 'node:module';
import * as path from 'node:path';

import type { ISeedKeySlice } from './harness.interfaces';
import type { SharedSeedSqlName } from './harness.type';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

export const PRODUCTS_FILE = path.join(REPO_ROOT, 'stock', 'products.json');

export const KEYS_FILE = path.join(REPO_ROOT, 'stock', 'keys.json');

export const ENV_FILE = path.join(REPO_ROOT, '.env');

export const DATABASE_URL_VAR = 'DATABASE_URL';

export const TEST_DATABASE_URL_VAR = 'TEST_DATABASE_URL';

export const DESTRUCTIVE_TESTS_VAR = 'ALLOW_DESTRUCTIVE_TESTS';

export const DESTRUCTIVE_TESTS_OPT_OUT = '1';

export const TEST_DATABASE_NAME_PATTERN = /(_test|test_|test$)/;

export const LEADING_SLASH_PATTERN = /^\//;

export const MISSING_DATABASE_URL_MESSAGE =
  'Интеграционным тестам нужна переменная TEST_DATABASE_URL (или DATABASE_URL): задайте её в окружении или в .env репозитория';

export const INVALID_DATABASE_URL_MESSAGE = 'Строка подключения не содержит имени базы данных';

export const UNSAFE_DATABASE_MESSAGE = 'Интеграционные тесты очищают базу целиком (TRUNCATE) и отказались работать с базой';

export const UNSAFE_DATABASE_HINT =
  'Имя не похоже на тестовое. Создайте отдельную базу (например store_test) и укажите её в TEST_DATABASE_URL ' +
  'или подтвердите разрушительный прогон переменной ALLOW_DESTRUCTIVE_TESTS=1.';

export const TEST_HOST = '127.0.0.1';

export const TEST_CATALOG_DEFAULT_LIMIT = 24;

export const TEST_CATALOG_MAX_LIMIT = 50;

export const TEST_SUPPLIER_VIRTUAL_STOCK = 1000;

export const DEFAULT_TEST_ENV: Readonly<Record<string, string>> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'error',
  LOG_FORMAT: 'json',
  CATALOG_DEFAULT_LIMIT: String(TEST_CATALOG_DEFAULT_LIMIT),
  CATALOG_MAX_LIMIT: String(TEST_CATALOG_MAX_LIMIT),
  SUPPLIER_VIRTUAL_STOCK: String(TEST_SUPPLIER_VIRTUAL_STOCK),
  // воркер по умолчанию выключен в интеграционных тестах — сьюты включают его явно через envOverrides,
  // иначе фоновый 200ms tick гоняется во всех сьютах и мешает teardown (гонка с app.close())
  WORKER_ENABLED: 'false',
};

export const RESET_DATABASE_SQL = `
  TRUNCATE issued_deliveries, delivery_attempts, ledger_entries, ledger_txns,
           payment_events, jobs, stock_keys, sku_stock, orders, products
  RESTART IDENTITY CASCADE
`;

export const RESET_ORDER_SEQUENCE_SQL = 'ALTER SEQUENCE order_ext_seq RESTART 100';

export const SEED_BATCH = 'seed';

export const SEED_UPSERT_FAILED_MESSAGE = 'Не удалось получить id товара после upsert';

export const SEED_KEY_DISTRIBUTION: readonly ISeedKeySlice[] = [
  { sku: 'KEY-CS2-PRIME', count: 20 },
  { sku: 'KEY-GTA5', count: 20 },
  { sku: 'KEY-EFT', count: 10 },
];

export const SEED_PRODUCT_UPSERT_SQL = `
  INSERT INTO products (sku, name, type, price_minor, currency, image_url, fulfillment_mode, is_active, in_stock)
  VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, FALSE)
  ON CONFLICT (sku) DO UPDATE SET
    name = EXCLUDED.name,
    type = EXCLUDED.type,
    price_minor = EXCLUDED.price_minor,
    currency = EXCLUDED.currency,
    image_url = EXCLUDED.image_url,
    fulfillment_mode = EXCLUDED.fulfillment_mode,
    is_active = TRUE,
    updated_at = now()
  RETURNING id
`;

export const SEED_KEYS_INSERT_SQL = `
  INSERT INTO stock_keys (product_id, code, status, batch)
  SELECT $1, code, 'available', $3 FROM unnest($2::text[]) AS code
  ON CONFLICT (product_id, code) DO NOTHING
`;

export const SEED_SKU_STOCK_POOL_SQL = `
  INSERT INTO sku_stock (product_id, available_count)
  VALUES ($1, (SELECT count(*)::int FROM stock_keys WHERE product_id = $1 AND status = 'available'))
  ON CONFLICT (product_id) DO UPDATE SET available_count = EXCLUDED.available_count, updated_at = now()
`;

export const SEED_SKU_STOCK_SUPPLIER_SQL = `
  INSERT INTO sku_stock (product_id, available_count) VALUES ($1, $2::int)
  ON CONFLICT (product_id) DO UPDATE SET available_count = EXCLUDED.available_count, updated_at = now()
`;

export const SEED_IN_STOCK_SYNC_SQL = `
  UPDATE products p SET in_stock = (s.available_count > 0), updated_at = now()
  FROM sku_stock s
  WHERE s.product_id = p.id AND p.in_stock <> (s.available_count > 0)
`;

export const TOOLS_SEED_CONSTANTS_FILE = path.join(REPO_ROOT, 'tools', 'src', 'seed-catalog.constants.ts');

export const TOOLS_SEED_SCRIPT = path.join(REPO_ROOT, 'tools', 'src', 'seed-catalog.ts');

export const TSX_CLI = createRequire(__filename).resolve('tsx/cli');

export const SHARED_SEED_SQL_NAMES = [
  'SEED_PRODUCT_UPSERT_SQL',
  'SEED_KEYS_INSERT_SQL',
  'SEED_SKU_STOCK_POOL_SQL',
  'SEED_SKU_STOCK_SUPPLIER_SQL',
  'SEED_IN_STOCK_SYNC_SQL',
] as const;

export const SHARED_SEED_SQL: Readonly<Record<SharedSeedSqlName, string>> = {
  SEED_PRODUCT_UPSERT_SQL,
  SEED_KEYS_INSERT_SQL,
  SEED_SKU_STOCK_POOL_SQL,
  SEED_SKU_STOCK_SUPPLIER_SQL,
  SEED_IN_STOCK_SYNC_SQL,
};

export const SQL_WHITESPACE_PATTERN = /\s+/g;

export const KEY_DISTRIBUTION_BLOCK_PATTERN = /export const KEY_DISTRIBUTION = \[([\s\S]*?)\]/;

export const KEY_SLICE_PATTERN = /\{\s*sku:\s*'([^']+)',\s*count:\s*(\d+)\s*\}/g;

export const CONSTANT_NOT_FOUND_MESSAGE = 'Константа не найдена в файле сидера';

export const SEEDED_SKUS_IN_BYTE_ORDER = [
  'GIFT-PSN-1000',
  'GIFT-ROBLOX-800',
  'GIFT-XBOX-1500',
  'KEY-CS2-PRIME',
  'KEY-EFT',
  'KEY-GTA5',
  'STEAM-TOPUP-1000',
  'STEAM-TOPUP-2500',
  'STEAM-TOPUP-500',
  'SUB-DISCORD-1M',
  'SUB-SPOTIFY-1M',
  'SUB-YT-3M',
] as const;

export const EXPECTED_SKU_COLLATION = 'C';

export const SKU_COLLATION_SQL = `
  SELECT c.collname
  FROM pg_attribute a
  JOIN pg_collation c ON c.oid = a.attcollation
  WHERE a.attrelid = 'products'::regclass AND a.attname = 'sku'
`;

export const COLLATION_PROBE_SKUS = ['ZZ-B', 'ZZ-a'] as const;

export const COLLATION_PROBE_SQL = `
  WITH inserted AS (
    INSERT INTO products (sku, name, type, price_minor, currency, image_url, fulfillment_mode, is_active, in_stock)
    VALUES ('ZZ-B', 'Проба сортировки B', 'topup', 100, 'RUB', NULL, 'supplier', TRUE, TRUE),
           ('ZZ-a', 'Проба сортировки a', 'topup', 100, 'RUB', NULL, 'supplier', TRUE, TRUE)
    RETURNING id
  )
  INSERT INTO sku_stock (product_id, available_count) SELECT id, 1 FROM inserted
`;

export const COUNT_PRODUCTS_SQL = 'SELECT count(*)::int AS count FROM products';

export const COUNT_KEYS_SQL = 'SELECT count(*)::int AS count FROM stock_keys';

export const KEY_COUNTS_BY_SKU_SQL = `
  SELECT p.sku, count(k.id)::int AS count
  FROM products p
  JOIN stock_keys k ON k.product_id = p.id
  GROUP BY p.sku
  ORDER BY p.sku
`;

export const PRODUCT_SNAPSHOT_SQL = `
  SELECT p.sku, p.type, p.fulfillment_mode, p.price_minor, p.in_stock, p.is_active, s.available_count
  FROM products p
  JOIN sku_stock s ON s.product_id = p.id
  WHERE p.sku = $1
`;
