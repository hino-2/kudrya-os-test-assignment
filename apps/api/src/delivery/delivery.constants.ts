export const ATTEMPT_STATE = {
  PENDING: 'pending',
  IN_FLIGHT: 'in_flight',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  ABANDONED_UNKNOWN: 'abandoned_unknown',
} as const;

export const DELIVERY_SOURCE = {
  POOL: 'pool',
  SUPPLIER: 'supplier',
} as const;

export const DELIVERY_OUTCOME = {
  DELIVERED: 'delivered',
  OUT_OF_STOCK: 'out_of_stock',
  ALREADY_DELIVERED: 'already_delivered',
  SKIPPED: 'skipped',
} as const;

export const DELIVERY_OUT_OF_STOCK_REASON = 'out_of_stock';

export const DELIVERY_TRANSACTION_REQUIRED_MESSAGE = 'Операция доставки требует открытой транзакции';

export const SUPPLIER_MODE_NOT_IMPLEMENTED_MESSAGE = 'Выдача через поставщика ещё не реализована (см. шаг 13)';

export const ISSUED_DELIVERY_LOST_MESSAGE = 'Строка выданного товара потеряна после вставки';

export const DELIVERY_FULFILMENT_SERVICES = 'DELIVERY_FULFILMENT_SERVICES';

export const INVALID_DELIVER_ORDER_PAYLOAD_MESSAGE = 'Некорректный payload задачи deliver_order';

export const ORDER_NOT_FOUND_FOR_DELIVERY_MESSAGE_TEMPLATE = 'Заказ %s не найден при попытке выдачи';

export const UNKNOWN_FULFILLMENT_MODE_MESSAGE_TEMPLATE = 'Неизвестный режим выдачи товара: %s';

export const LOCK_ORDER_FOR_DELIVERY_SQL = `
  SELECT o.id, o.ext_id, o.status, o.delivery_generation AS generation, o.product_id,
         o.sku, o.total_minor AS amount_minor, o.currency, p.fulfillment_mode
  FROM orders o
  JOIN products p ON p.id = o.product_id
  WHERE o.id = $1
  FOR UPDATE OF o
`;

export const FIND_FULFILLMENT_MODE_SQL = `
  SELECT p.fulfillment_mode
  FROM orders o
  JOIN products p ON p.id = o.product_id
  WHERE o.id = $1
`;

export const FIND_ISSUED_DELIVERY_SQL = `
  SELECT id, code FROM issued_deliveries WHERE order_id = $1
`;

export const INSERT_ISSUED_DELIVERY_SQL = `
  INSERT INTO issued_deliveries (order_id, product_id, sku, code, source, stock_key_id)
  VALUES ($1, $2, $3, $4, 'pool', $5)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id, code
`;
