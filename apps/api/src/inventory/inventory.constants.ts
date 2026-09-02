export const STOCK_KEY_STATUS = {
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  ISSUED: 'issued',
} as const;

export const INVENTORY_TRANSACTION_REQUIRED_MESSAGE = 'Операция с остатками требует открытой транзакции';

export const RESERVE_KEY_SQL = `
  UPDATE stock_keys k
  SET status = 'reserved', order_id = $2, reserved_at = now()
  WHERE k.id = (
    SELECT id FROM stock_keys
    WHERE product_id = $1 AND status = 'available'
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING k.id, k.code
`;

export const FIND_RESERVED_KEY_SQL = `
  SELECT id, code FROM stock_keys WHERE order_id = $1 AND status IN ('reserved','issued')
`;

export const MARK_KEY_ISSUED_SQL = `
  UPDATE stock_keys SET status = 'issued', issued_at = now() WHERE id = $1 AND status = 'reserved'
  RETURNING id
`;

export const DECREMENT_AVAILABLE_SQL = `
  UPDATE sku_stock
  SET available_count = available_count - 1, reserved_count = reserved_count + 1, updated_at = now()
  WHERE product_id = $1 AND available_count > 0
  RETURNING available_count
`;

export const MOVE_RESERVED_TO_ISSUED_SQL = `
  UPDATE sku_stock
  SET reserved_count = reserved_count - 1, issued_count = issued_count + 1, updated_at = now()
  WHERE product_id = $1 AND reserved_count > 0
`;

export const DRAIN_AVAILABLE_SQL = `
  UPDATE sku_stock SET available_count = 0, updated_at = now() WHERE product_id = $1
`;

export const SYNC_PRODUCT_IN_STOCK_SQL = `
  UPDATE products p
  SET in_stock = (s.available_count > 0)
  FROM sku_stock s
  WHERE s.product_id = p.id AND p.id = $1
`;
