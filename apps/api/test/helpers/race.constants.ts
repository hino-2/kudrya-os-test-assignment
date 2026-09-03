export const WEBHOOK_PAYMENT_PATH = '/webhooks/payment';

export const CONTROL_RESET_PATH = '/_control/reset';

export const RACE_EVENT_ID_PREFIX = 'evt_race_';

export const RACE_CURRENCY = 'RUB';

export const RACE_PAYMENT_STATUS = 'paid';

// разброс created_at вокруг общей базовой отметки времени: достаточно широк, чтобы часть
// событий заведомо оказалась "раньше" уже применённого (и получила ignored_stale), но не
// настолько широк, чтобы вылезти за orphan_ttl/другие временные допущения домена
export const RACE_JITTER_MAX_MS = 5000;

// заказ ещё не создан на момент выдачи первой попытки доставки — первая (и в этих тестах
// единственная) попытка всегда идёт с исходным delivery_generation=0 (см. миграцию InitCore)
// и attempt_no=1 на поставщике A (fallback-цепочка ещё не тронута)
export const RACE_INITIAL_DELIVERY_GENERATION = 0;

export const RACE_FIRST_SUPPLIER_ATTEMPT_NO = 1;

export const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

export const JOB_NOT_DONE_MESSAGE_TEMPLATE = 'Задача доставки для заказа не перешла в done за отведённое время';

export const RACE_WAIT_FOR_DELIVERED_TIMEOUT_MS = 10000;

// mulberry32 — детерминированный PRNG без внешней зависимости: тестам нужен воспроизводимый
// (не Math.random) разброс created_at, а не криптографическое качество случайности
export const RACE_PRNG_SEED = 0x5eedface;

export const RACE_EVENT_COUNT = 50;

export const RACE_ITERATIONS = 5;

export const SUPPLIER_RACE_SKU = 'STEAM-TOPUP-500';

export const SUPPLIER_RACE_SKU_AMOUNT_MAJOR = 500;

export const POOL_RACE_SKU = 'KEY-CS2-PRIME';

export const POOL_RACE_SKU_AMOUNT_MAJOR = 1290;

export const SELECT_ORDER_ID_BY_EXT_ID_SQL = 'SELECT id FROM orders WHERE ext_id = $1';

export const SELECT_ORDER_STATUS_BY_EXT_ID_SQL = 'SELECT status FROM orders WHERE ext_id = $1';

export const COUNT_PAYMENT_EVENTS_BY_ORDER_SQL = 'SELECT count(*)::int AS count FROM payment_events WHERE order_ext_id = $1';

export const COUNT_APPLIED_PAYMENT_EVENTS_SQL =
  "SELECT count(*)::int AS count FROM payment_events WHERE order_ext_id = $1 AND state = 'applied'";

export const COUNT_DELIVER_ORDER_JOBS_SQL =
  "SELECT count(*)::int AS count FROM jobs WHERE kind = 'deliver_order' AND dedupe_key = $1";

export const COUNT_ISSUED_DELIVERIES_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM issued_deliveries WHERE order_id = $1';

export const COUNT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM delivery_attempts WHERE order_id = $1';

export const SELECT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL = `
  SELECT supplier_code, attempt_no, state, request_id
  FROM delivery_attempts
  WHERE order_id = $1
  ORDER BY id
`;

export const COUNT_LEDGER_TXNS_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM ledger_txns WHERE order_id = $1';

export const COUNT_LEDGER_ENTRIES_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM ledger_entries WHERE order_id = $1';

export const SUM_SIGNED_MINOR_GLOBAL_SQL = 'SELECT COALESCE(sum(signed_minor), 0)::bigint AS sum FROM ledger_entries';

export const COUNT_UNBALANCED_LEDGER_TXNS_SQL = `
  SELECT count(*)::int AS count FROM (
    SELECT txn_id FROM ledger_entries GROUP BY txn_id HAVING sum(signed_minor) <> 0
  ) unbalanced
`;

export const CASH_DEBIT_SUMMARY_BY_ORDER_ID_SQL = `
  SELECT count(*)::int AS count, COALESCE(sum(amount_minor), 0)::bigint AS sum
  FROM ledger_entries
  WHERE order_id = $1 AND account = 'cash' AND direction = 'debit'
`;

export const COUNT_STOCK_KEYS_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM stock_keys WHERE order_id = $1';

export const SELECT_AVAILABLE_COUNT_BY_SKU_SQL = `
  SELECT s.available_count FROM sku_stock s JOIN products p ON p.id = s.product_id WHERE p.sku = $1
`;

