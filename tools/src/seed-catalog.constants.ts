import * as path from 'node:path';

import { REPO_ROOT } from './lib/lib.constants';

export const PRODUCTS_FILE = path.join(REPO_ROOT, 'stock', 'products.json');

export const KEYS_FILE = path.join(REPO_ROOT, 'stock', 'keys.json');

export const DATABASE_URL_VAR = 'DATABASE_URL';

export const SUPPLIER_VIRTUAL_STOCK_VAR = 'SUPPLIER_VIRTUAL_STOCK';

export const DEFAULT_SUPPLIER_VIRTUAL_STOCK = 1000;

export const MIN_SUPPLIER_VIRTUAL_STOCK = 0;

export const MINOR_UNITS_PER_MAJOR = 100;

export const SEED_BATCH = 'seed';

export const SEED_PRODUCT_TYPE = {
  KEY: 'key',
  TOPUP: 'topup',
  SUBSCRIPTION: 'subscription',
  GIFTCARD: 'giftcard',
} as const;

export const SEED_FULFILLMENT_MODE = {
  POOL: 'pool',
  SUPPLIER: 'supplier',
} as const;

export const KEY_DISTRIBUTION = [
  { sku: 'KEY-CS2-PRIME', count: 20 },
  { sku: 'KEY-GTA5', count: 20 },
  { sku: 'KEY-EFT', count: 10 },
] as const;

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

export const SEED_VERIFY_SQL = `
  SELECT p.sku, p.type, p.fulfillment_mode, p.price_minor::text AS price_minor, p.in_stock,
         s.available_count,
         (SELECT count(*)::int FROM stock_keys k WHERE k.product_id = p.id) AS key_count
  FROM products p
  JOIN sku_stock s ON s.product_id = p.id
  WHERE p.sku = ANY($1::text[])
  ORDER BY p.sku
`;

export const SUMMARY_SKU_WIDTH = 18;

export const SUMMARY_MODE_WIDTH = 9;

export const SUMMARY_NUMBER_WIDTH = 12;

export const SUMMARY_HEADER = [
  'sku'.padEnd(SUMMARY_SKU_WIDTH),
  'mode'.padEnd(SUMMARY_MODE_WIDTH),
  'price_minor'.padStart(SUMMARY_NUMBER_WIDTH),
  'available'.padStart(SUMMARY_NUMBER_WIDTH),
  'keys'.padStart(SUMMARY_NUMBER_WIDTH),
].join(' ');

export const INVALID_FILE_MESSAGE = 'Некорректный формат файла';

export const INVALID_PRODUCT_MESSAGE = 'Некорректная запись товара';

export const UPSERT_FAILED_MESSAGE = 'Не удалось получить id товара после upsert';

export const VERIFY_PRODUCT_COUNT_MESSAGE = 'Сверка после сида: неверное число товаров';

export const VERIFY_KEY_COUNT_MESSAGE = 'Сверка после сида: неверная раскладка ключей по SKU';

export const MISSING_KEY_SLICE_MESSAGE = 'Для товара в режиме pool не задана доля ключей в KEY_DISTRIBUTION';

export const SEED_ROLLED_BACK_MESSAGE = 'Сид каталога прерван, транзакция откачена:';

export const SEED_POST_COMMIT_FAILED_MESSAGE =
  'Данные записаны и транзакция зафиксирована, но последующая сверка не удалась (база изменена):';

export const SEED_DONE_MESSAGE = 'Каталог засеян';
