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

// источник истины по остатку — stock_keys, а sku_stock лишь его зеркало, поэтому ключ, уже
// выигранный под FOR UPDATE SKIP LOCKED, обязан быть выдан даже при разошедшемся счётчике.
// Отсюда GREATEST вместо охраны available_count > 0: охрана отдавала 0 строк и (после того как
// её результат перестали игнорировать) роняла джобу, то есть отказывала в доставке оплаченного
// заказа из-за расхождения зеркала. Клампинг не даёт счётчику уйти в минус, а сойдётся он
// на следующем RECOUNT_AVAILABLE_SQL.
export const DECREMENT_AVAILABLE_SQL = `
  UPDATE sku_stock
  SET available_count = GREATEST(available_count - 1, 0), reserved_count = reserved_count + 1, updated_at = now()
  WHERE product_id = $1
  RETURNING available_count
`;

export const MOVE_RESERVED_TO_ISSUED_SQL = `
  UPDATE sku_stock
  SET reserved_count = GREATEST(reserved_count - 1, 0), issued_count = issued_count + 1, updated_at = now()
  WHERE product_id = $1
  RETURNING reserved_count
`;

// блокировка строки остатка отдельным оператором обязательна перед любым UPDATE, чей подзапрос
// читает другую таблицу: при ожидании блокировки внутри UPDATE снапшот подзапроса не
// продвигается (EvalPlanQual переиспользует es_snapshot оператора), поэтому пересчёт видел бы
// stock_keys такими, какими они были до коммита конкурента, и затирал бы уже закоммиченный
// admin-restock. Проверено на живой БД: без этого оператора счётчик уезжал в 0 при 5 реально
// свободных ключах, с ним — сходится. Тот же довод относится к SYNC_PRODUCT_IN_STOCK_SQL.
export const LOCK_SKU_STOCK_SQL = `
  SELECT 1 FROM sku_stock WHERE product_id = $1 FOR UPDATE
`;

// пересчёт вместо слепого обнуления: reserveKey отдаёт null и когда свободных ключей нет,
// и когда все свободные заблокированы конкурентной транзакцией (FOR UPDATE SKIP LOCKED);
// обнуление во втором случае навсегда занижало счётчики и убирало живой ключ с витрины.
// Подзапрос — index-only count по idx_stock_keys_available (product_id, id) WHERE status='available',
// внешний UPDATE — по PK sku_stock (product_id): новых индексов не требуется.
export const RECOUNT_AVAILABLE_SQL = `
  UPDATE sku_stock s
  SET available_count = (
        SELECT count(*)::int FROM stock_keys k
        WHERE k.product_id = s.product_id AND k.status = 'available'
      ),
      updated_at = now()
  WHERE s.product_id = $1
  RETURNING available_count
`;

export const SYNC_PRODUCT_IN_STOCK_SQL = `
  UPDATE products p
  SET in_stock = (s.available_count > 0)
  FROM sku_stock s
  WHERE s.product_id = p.id AND p.id = $1
`;

// admin restock (§7.3 admin endpoints): блокирует товар + строку остатка по SKU перед пополнением
export const LOCK_PRODUCT_STOCK_BY_SKU_SQL = `
  SELECT p.id, p.sku, p.fulfillment_mode, s.available_count
  FROM products p
  JOIN sku_stock s ON s.product_id = p.id
  WHERE p.sku = $1
  FOR UPDATE OF p, s
`;

export const INSERT_RESTOCK_KEYS_SQL = `
  INSERT INTO stock_keys (product_id, code, status, batch)
  SELECT $1, code, 'available', $3 FROM unnest($2::text[]) AS code
  ON CONFLICT (product_id, code) DO NOTHING
  RETURNING id
`;

export const BUMP_AVAILABLE_COUNT_SQL = `
  UPDATE sku_stock SET available_count = available_count + $2, updated_at = now()
  WHERE product_id = $1
  RETURNING available_count
`;

export const RESTOCK_BATCH = 'admin';

// строки sku_stock нет там, где вызывающий уже взял её под FOR UPDATE в этой же транзакции.
// Единственный такой путь — bumpAvailableCount из admin-эндпоинта, поэтому последствие это
// 500 на POST /admin/products/:sku/restock, а не повтор джобы: на путях доставки счётчик
// кламплится и расхождение сходится следующим пересчётом, а не роняет выдачу.
export const INVENTORY_COUNTER_DRIFT_MESSAGE =
  'Счётчики sku_stock разошлись с stock_keys: CAS-переход остатка не нашёл строки';
