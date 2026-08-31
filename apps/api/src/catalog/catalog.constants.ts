export const PRODUCT_TYPE = {
  KEY: 'key',
  TOPUP: 'topup',
  SUBSCRIPTION: 'subscription',
  GIFTCARD: 'giftcard',
} as const;

export const FULFILLMENT_MODE = {
  POOL: 'pool',
  SUPPLIER: 'supplier',
} as const;

export const PRODUCT_TYPE_VALUES = Object.values(PRODUCT_TYPE);

export const CATALOG_ROUTE = 'catalog';

export const CATALOG_SKU_ROUTE = ':sku';

export const CATALOG_LIMIT_MIN = 1;

export const CATALOG_LIMIT_HARD_MAX = 100;

export const CATALOG_IN_STOCK_DEFAULT = true;

export const BOOLEAN_TRUE_PARAMS = ['true', '1'] as const;

export const SKU_PARAM_REGEX = /^[A-Za-z0-9._-]{1,64}$/;

export const SKU_PREFIX_REGEX = /^[A-Za-z0-9_-]+$/;

export const SKU_PREFIX_MAX_LENGTH = 64;

export const LIKE_ESCAPE_PATTERN = /[\\_%]/g;

export const LIKE_ESCAPE_REPLACEMENT = '\\$&';

export const CATALOG_LIST_SQL = `
  SELECT p.id, p.sku, p.name, p.type, p.price_minor, p.currency, p.image_url,
         COALESCE(s.available_count, 0) AS available_count
  FROM products p
  JOIN sku_stock s ON s.product_id = p.id
  WHERE p.is_active
    AND ($1::text IS NULL OR p.type = $1)
    AND ($2::bool IS NOT TRUE OR p.in_stock)
    AND ($3::text IS NULL OR p.sku LIKE $3 || '%')
    AND ($4::text IS NULL OR (p.sku, p.id) > ($4, $5::bigint))
  ORDER BY p.sku, p.id
  LIMIT $6
`;

export const CATALOG_ITEM_SQL = `
  SELECT p.id, p.sku, p.name, p.type, p.price_minor, p.currency, p.image_url,
         COALESCE(s.available_count, 0) AS available_count
  FROM products p
  LEFT JOIN sku_stock s ON s.product_id = p.id
  WHERE p.sku = $1 AND p.is_active
  LIMIT 1
`;
