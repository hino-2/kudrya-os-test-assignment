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
  DELIVERY_FAILED: 'delivery_failed',
} as const;

export const DELIVERY_OUT_OF_STOCK_REASON = 'out_of_stock';

export const SUPPLIER_JOB_LAST_ATTEMPT_MESSAGE_TEMPLATE = 'Последняя попытка задачи выдачи через поставщика исчерпана без терминального исхода: %s';

export const DELIVERY_TRANSACTION_REQUIRED_MESSAGE = 'Операция доставки требует открытой транзакции';

export const ISSUED_DELIVERY_LOST_MESSAGE = 'Строка выданного товара потеряна после вставки';

export const DELIVERY_ATTEMPT_LOST_MESSAGE = 'Строка попытки выдачи потеряна после вставки';

export const SUPPLIER_JOB_BUDGET_EXCEEDED_MESSAGE = 'Бюджет времени на выдачу через поставщика в рамках задачи исчерпан';

export const SUPPLIER_ISSUED_WITHOUT_CODE_MESSAGE = 'Поставщик вернул исход issued без кода — нарушение контракта supplier.client';

export const DELIVERY_ATTEMPT_UNKNOWN_RETRY_MESSAGE_TEMPLATE = 'Статус попытки %s остаётся неизвестным — требуется повтор задачи для дозвона к поставщику';

export const ALL_SUPPLIERS_FAILED_MESSAGE_TEMPLATE = 'Не удалось выдать заказ ни у одного поставщика: %s';

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

export const INSERT_SUPPLIER_ISSUED_DELIVERY_SQL = `
  INSERT INTO issued_deliveries (order_id, product_id, sku, code, source, supplier_code, delivery_attempt_id)
  VALUES ($1, $2, $3, $4, 'supplier', $5, $6)
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id, code
`;

const DELIVERY_ATTEMPT_COLUMNS = `
  id, order_id, supplier_code, attempt_no, request_id, sku, state, http_status, response_code,
  error_kind, error_reason, resolve_attempts, next_resolve_at, started_at, finished_at, duration_ms,
  created_at, updated_at
`;

export const FIND_OPEN_ATTEMPT_SQL = `
  SELECT ${DELIVERY_ATTEMPT_COLUMNS}
  FROM delivery_attempts
  WHERE order_id = $1 AND state IN ('pending','in_flight','unknown')
  LIMIT 1
`;

export const FIND_ATTEMPTS_BY_ORDER_SQL = `
  SELECT ${DELIVERY_ATTEMPT_COLUMNS}
  FROM delivery_attempts
  WHERE order_id = $1
  ORDER BY id
`;

// TX-S1: durable-маркер 'in_flight' должен закоммититься до HTTP-вызова поставщику — без него
// таймаут/сбой воркера после отправки запроса неотличим от того, что запрос вообще не уходил.
export const INSERT_DELIVERY_ATTEMPT_SQL = `
  INSERT INTO delivery_attempts (order_id, supplier_code, attempt_no, request_id, sku, state, started_at)
  VALUES ($1,$2,$3,$4,$5,'in_flight', now())
  -- предикат WHERE обязателен: без него Postgres не свяжет ON CONFLICT с частичным уникальным индексом
  ON CONFLICT (order_id) WHERE state IN ('pending','in_flight','unknown') DO NOTHING
  RETURNING ${DELIVERY_ATTEMPT_COLUMNS}
`;

// возобновление уже открытой попытки (in_flight после сбоя воркера, unknown в ожидании
// дозвона) — request_id не меняется, повторный POST /issue с тем же request_id идемпотентен
// на стороне поставщика
export const RESUME_DELIVERY_ATTEMPT_SQL = `
  UPDATE delivery_attempts
  SET state = 'in_flight', started_at = now(), updated_at = now()
  WHERE id = $1 AND state IN ('in_flight','unknown')
  RETURNING ${DELIVERY_ATTEMPT_COLUMNS}
`;

export const FINALIZE_ATTEMPT_SUCCEEDED_SQL = `
  UPDATE delivery_attempts
  SET state = 'succeeded', http_status = $2, response_code = $3, finished_at = now(),
      duration_ms = $4, updated_at = now()
  WHERE id = $1 AND state = 'in_flight'
  RETURNING id
`;

export const FINALIZE_ATTEMPT_FAILED_SQL = `
  UPDATE delivery_attempts
  SET state = 'failed', http_status = $2, error_kind = $3, error_reason = $4, finished_at = now(),
      duration_ms = $5, updated_at = now()
  WHERE id = $1 AND state = 'in_flight'
  RETURNING id
`;

// resolve_attempts считает каждый переход попытки в unknown (включая первый) — бюджет
// дозвонов до поставщика перед тем, как считать попытку abandoned_unknown (см. supplier-plan.util)
export const PROMOTE_ATTEMPT_TO_UNKNOWN_SQL = `
  UPDATE delivery_attempts
  SET state = 'unknown', http_status = $2, error_kind = $3, error_reason = $4,
      resolve_attempts = resolve_attempts + 1, next_resolve_at = $5, updated_at = now()
  WHERE id = $1 AND state = 'in_flight'
  RETURNING resolve_attempts
`;

// abandoned_unknown выходит из-под partial unique index delivery_attempts_open_uq — освобождает
// заказ для попытки со следующим поставщиком, не дожидаясь ручного разрешения (см. README §6)
export const MARK_ATTEMPT_ABANDONED_SQL = `
  UPDATE delivery_attempts
  SET state = 'abandoned_unknown', finished_at = now(), updated_at = now()
  WHERE id = $1 AND state = 'unknown'
  RETURNING id
`;

// sweeper pass 5a: попытки, зависшие в in_flight дольше attemptInflightTimeoutMs — воркер,
// скорее всего, умер после TX-S1 коммита, не успев дождаться ответа поставщика. Нет
// специализированного индекса под этот скан (см. README §4.3, осознанный компромисс).
export const DEMOTE_STALE_INFLIGHT_SQL = `
  UPDATE delivery_attempts a
  SET state = 'unknown', error_kind = 'inflight_expired', error_reason = $2,
      resolve_attempts = resolve_attempts + 1, next_resolve_at = now(), updated_at = now()
  FROM (
    SELECT id FROM delivery_attempts
    WHERE state = 'in_flight' AND started_at < now() - ($1 || ' milliseconds')::interval
    ORDER BY id
    FOR UPDATE SKIP LOCKED
    LIMIT $3
  ) stale
  WHERE a.id = stale.id
  RETURNING a.id, a.order_id, a.supplier_code, a.attempt_no
`;

// sweeper pass 5b: unknown-попытки, готовые к передозвону поставщику — идёт через
// idx_delivery_attempts_resolvable
export const FIND_RESOLVABLE_UNKNOWN_ATTEMPTS_SQL = `
  SELECT a.id, a.order_id, o.ext_id, o.delivery_generation
  FROM delivery_attempts a
  JOIN orders o ON o.id = a.order_id
  WHERE a.state = 'unknown' AND a.next_resolve_at <= now()
  ORDER BY a.next_resolve_at
  FOR UPDATE OF a SKIP LOCKED
  LIMIT $1
`;
