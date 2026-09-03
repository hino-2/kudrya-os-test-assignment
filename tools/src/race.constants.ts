export const API_BASE_URL_VAR = 'API_BASE_URL';

export const SUPPLIER_A_BASE_URL_VAR = 'SUPPLIER_A_BASE_URL';

export const DATABASE_URL_VAR = 'DATABASE_URL';

export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export const DEFAULT_SUPPLIER_A_BASE_URL = 'http://localhost:4001';

export const ORDERS_PATH = '/orders';

export const WEBHOOK_PAYMENT_PATH = '/webhooks/payment';

export const CONTROL_SCENARIO_PATH = '/_control/scenario';

export const CONTROL_RESET_PATH = '/_control/reset';

// это не "правильный" сценарий заглушки для проверки fallback-цепочки — race.ts проверяет
// сериализацию гонки вебхуков и ровно один эффект доставки, а не поведение поставщика при
// сбоях, поэтому сценарий принудительно переводится в предсказуемый 'ok' на время прогона
export const SCENARIO_MODE_OK = 'ok';

export const SCENARIO_MODE_NORMAL = 'normal';

export const FULFILLMENT_MODE = {
  POOL: 'pool',
  SUPPLIER: 'supplier',
} as const;

export const PAYMENT_RESULT = {
  APPLIED: 'applied',
  DUPLICATE: 'duplicate',
  ORPHAN: 'orphan',
  IGNORED_STALE: 'ignored_stale',
  IGNORED_ALREADY_PAID: 'ignored_already_paid',
  IGNORED_TERMINAL: 'ignored_terminal',
  CONFLICT: 'conflict',
  REJECTED_AMOUNT: 'rejected_amount',
} as const;

export const JOB_STATE_DONE = 'done';

// повторяет apps/api/src/jobs/jobs.util.ts::buildDeliverOrderDedupeKey — tools не может
// импортировать код apps/api (отдельный npm-workspace), поэтому формат ключа продублирован
export const JOB_DEDUPE_ORDER_PREFIX = 'order:';

export const DEFAULT_SKU = 'STEAM-TOPUP-500';

export const DEFAULT_EVENT_COUNT = 50;

export const DEFAULT_CURRENCY = 'RUB';

export const DEFAULT_TIMEOUT_MS = 5000;

export const DEFAULT_POLL_INTERVAL_MS = 200;

export const DEFAULT_POLL_TIMEOUT_MS = 15000;

export const EVENT_ID_PREFIX = 'evt_race_cli_';

// см. apps/api/test/helpers/race.constants.ts — тот же приём (без общего кода: разные
// npm-workspace), детерминированный разброс created_at вокруг общей базовой отметки времени
export const RACE_JITTER_MAX_MS = 5000;

export const RACE_PRNG_SEED = 0x5eedface;

export const MISSING_ORDER_OR_SKU_MESSAGE = 'Нужно указать либо --order (существующий ext_id), либо --sku (создать новый заказ)';

export const ORDER_CREATE_FAILED_MESSAGE = 'Не удалось создать заказ через POST /orders';

export const ORDER_LOOKUP_FAILED_MESSAGE = 'Не удалось получить заказ через GET /orders/:orderId';

export const ORDER_NOT_DELIVERED_MESSAGE = 'Заказ не перешёл в терминальный статус доставки за отведённое время';

export const SELECT_ORDER_ID_BY_EXT_ID_SQL = 'SELECT id FROM orders WHERE ext_id = $1';

export const SELECT_FULFILLMENT_MODE_BY_ORDER_ID_SQL = `
  SELECT p.fulfillment_mode
  FROM orders o JOIN products p ON p.id = o.product_id
  WHERE o.id = $1
`;

export const COUNT_PAYMENT_EVENTS_BY_ORDER_SQL = 'SELECT count(*)::int AS count FROM payment_events WHERE order_ext_id = $1';

export const COUNT_APPLIED_PAYMENT_EVENTS_SQL =
  "SELECT count(*)::int AS count FROM payment_events WHERE order_ext_id = $1 AND state = 'applied'";

export const COUNT_UNEXPECTED_PAYMENT_EVENTS_SQL = `
  SELECT count(*)::int AS count FROM payment_events
  WHERE order_ext_id = $1 AND state NOT IN ('applied', 'ignored_already_paid', 'ignored_stale')
`;

export const COUNT_DELIVER_ORDER_JOBS_SQL = "SELECT count(*)::int AS count FROM jobs WHERE kind = 'deliver_order' AND dedupe_key = $1";

export const SELECT_DELIVER_ORDER_JOB_STATE_SQL =
  "SELECT state FROM jobs WHERE kind = 'deliver_order' AND dedupe_key = $1 ORDER BY id DESC LIMIT 1";

export const COUNT_ISSUED_DELIVERIES_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM issued_deliveries WHERE order_id = $1';

export const COUNT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM delivery_attempts WHERE order_id = $1';

export const COUNT_SUCCEEDED_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL =
  "SELECT count(*)::int AS count FROM delivery_attempts WHERE order_id = $1 AND state = 'succeeded'";

export const COUNT_LEDGER_TXNS_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM ledger_txns WHERE order_id = $1';

export const COUNT_LEDGER_ENTRIES_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM ledger_entries WHERE order_id = $1';

export const SUM_SIGNED_MINOR_BY_ORDER_ID_SQL = 'SELECT COALESCE(sum(signed_minor), 0)::bigint AS sum FROM ledger_entries WHERE order_id = $1';

export const CASH_DEBIT_SUMMARY_BY_ORDER_ID_SQL = `
  SELECT count(*)::int AS count, COALESCE(sum(amount_minor), 0)::bigint AS sum
  FROM ledger_entries
  WHERE order_id = $1 AND account = 'cash' AND direction = 'debit'
`;

export const COUNT_STOCK_KEYS_BY_ORDER_ID_SQL = 'SELECT count(*)::int AS count FROM stock_keys WHERE order_id = $1';

export const HELP_TEXT = `
Использование: npm run race -- (--order <ext_id> | --sku <sku>) [опции]

Один из двух:
  --order <ext_id>       прогнать гонку против уже существующего заказа
  --sku <sku>             создать новый заказ под этот SKU (по умолчанию ${DEFAULT_SKU})

Опциональные:
  --count <число>         число параллельных вебхуков, по умолчанию ${DEFAULT_EVENT_COUNT}
  --amount <число>        сумма в рублях (major units); по умолчанию — цена заказа
  --currency <код>        по умолчанию ${DEFAULT_CURRENCY}
  --api <url>             базовый URL API, по умолчанию $API_BASE_URL или ${DEFAULT_API_BASE_URL}
  --timeout-ms <число>    таймаут одного HTTP-запроса, по умолчанию ${DEFAULT_TIMEOUT_MS}
  --no-db                 пропустить SQL-проверки (нужны только HTTP-проверки)
  --no-stub-control       не трогать /_control/scenario стенда поставщика A
  --reset-stubs           вызвать /_control/reset стенда поставщика A перед прогоном
  --help                  показать эту справку
`;
