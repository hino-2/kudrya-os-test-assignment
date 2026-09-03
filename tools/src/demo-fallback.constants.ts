import type { FailMode, ScenarioMode } from './demo-fallback.type';

export const API_BASE_URL_VAR = 'API_BASE_URL';

export const SUPPLIER_A_BASE_URL_VAR = 'SUPPLIER_A_BASE_URL';

export const SUPPLIER_B_BASE_URL_VAR = 'SUPPLIER_B_BASE_URL';

export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export const DEFAULT_SUPPLIER_A_BASE_URL = 'http://localhost:4001';

export const DEFAULT_SUPPLIER_B_BASE_URL = 'http://localhost:4002';

export const ORDERS_PATH = '/orders';

export const CATALOG_PATH = '/catalog';

export const WEBHOOK_PAYMENT_PATH = '/webhooks/payment';

export const CONTROL_SCENARIO_PATH = '/_control/scenario';

export const CONTROL_RESET_PATH = '/_control/reset';

export const CONTROL_STATE_PATH = '/_control/state';

// повторяет apps/supplier-stub/src/scenario/scenario.constants.ts и
// apps/api/src/delivery/*.constants.ts — tools не может импортировать код apps/* (отдельный
// npm-workspace), поэтому нужные значения продублированы намеренно
export const SCENARIO_MODE = {
  NORMAL: 'normal',
  OK: 'ok',
  ERROR_5XX: 'error_5xx',
  BAD_REQUEST: 'bad_request',
} as const;

export const FAIL_MODE = {
  ERROR_5XX: 'error_5xx',
  BAD_REQUEST: 'bad_request',
  STOPPED: 'stopped',
} as const;

// stopped -> null: поставщик A не должен переводиться ни в какой сценарий, он просто недоступен
// (docker compose stop supplier-a / погашенный процесс) — /_control/scenario к нему не дозвонится
export const FAIL_MODE_SCENARIO: Record<FailMode, ScenarioMode | null> = {
  [FAIL_MODE.ERROR_5XX]: SCENARIO_MODE.ERROR_5XX,
  [FAIL_MODE.BAD_REQUEST]: SCENARIO_MODE.BAD_REQUEST,
  [FAIL_MODE.STOPPED]: null,
};

// refuse/timeout/slow сознательно не входят сюда: они классифицируются как error_kind='unknown'
// (см. classifySupplierNetworkError) и по дизайну НЕ переключают pickSupplier на B — только
// settleUnknown умеет их закрывать повторным дозвоном, поэтому этот демо-скрипт с ними бы либо
// завис на ожидании delivered, либо ошибочно доложил FAIL там, где система ведёт себя штатно
export const EXPECTED_ERROR_KINDS: Record<FailMode, readonly string[]> = {
  [FAIL_MODE.ERROR_5XX]: ['http_5xx'],
  [FAIL_MODE.BAD_REQUEST]: ['http_4xx'],
  [FAIL_MODE.STOPPED]: ['connection_refused'],
};

export const SUPPLIER_CODE = {
  A: 'A',
  B: 'B',
} as const;

export const DELIVERY_SOURCE_SUPPLIER = 'supplier';

export const ATTEMPT_STATE = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export const ORDER_STATUS = {
  PAID: 'paid',
  DELIVERED: 'delivered',
  DELIVERY_FAILED: 'delivery_failed',
  OUT_OF_STOCK: 'out_of_stock',
  PAYMENT_FAILED: 'payment_failed',
} as const;

export const SETTLED_ORDER_STATUSES = [
  ORDER_STATUS.DELIVERED,
  ORDER_STATUS.DELIVERY_FAILED,
  ORDER_STATUS.OUT_OF_STOCK,
  ORDER_STATUS.PAYMENT_FAILED,
] as const;

export const PAYMENT_RESULT_APPLIED = 'applied';

export const POOL_PRODUCT_TYPE = 'key';

export const DEFAULT_SKU = 'STEAM-TOPUP-500';

export const DEFAULT_CURRENCY = 'RUB';

export const DEFAULT_TIMEOUT_MS = 5000;

export const DEFAULT_WAIT_MS = 20000;

export const DEFAULT_POLL_INTERVAL_MS = 250;

export const EVENT_ID_PREFIX = 'evt_demo_fallback_';

export const CHECK_NAME = {
  SKU_SUPPLIER_MODE: 'sku-supplier-mode',
  ORDER_READY: 'order-ready',
  PAYMENT_APPLIED: 'payment-applied',
  ORDER_DELIVERED: 'order-delivered',
  DELIVERY_FROM_B: 'delivery-from-supplier-b',
  ATTEMPT_A_FAILED: 'attempt-a-definitive-failure',
  ATTEMPT_B_SUCCEEDED: 'attempt-b-succeeded',
  REQUEST_IDS_DIFFER: 'request-ids-differ',
  SINGLE_SUCCEEDED_ATTEMPT: 'single-succeeded-attempt',
  STUB_A_MINTED_NONE: 'stub-a-minted-nothing',
  STUB_B_MINTED_ONE: 'stub-b-minted-one',
} as const;

export const ALL_CHECK_NAMES = Object.values(CHECK_NAME);

export const ATTEMPTS_TABLE_HEADERS = ['SUPPLIER', 'ATTEMPT', 'STATE', 'ERROR_KIND', 'REQUEST_ID', 'MS'];

export const EMPTY_CELL = '-';

export const INVALID_FAIL_MODE_MESSAGE = 'Недопустимое значение --fail-mode (ожидается error_5xx|bad_request|stopped)';

export const ORDER_CREATE_FAILED_MESSAGE = 'Не удалось создать заказ через POST /orders';

export const ORDER_LOOKUP_FAILED_MESSAGE = 'Не удалось получить заказ через GET /orders/:orderId';

export const CATALOG_LOOKUP_FAILED_MESSAGE = 'Не удалось получить карточку товара через GET /catalog/:sku';

export const WEBHOOK_FAILED_MESSAGE = 'Вебхук оплаты не был принят';

export const ORDER_NOT_DELIVERED_MESSAGE = 'Заказ не перешёл в delivered за отведённое время';

export const POOL_SKU_MESSAGE = 'SKU выдаётся из пула — фолбэк поставщиков не задействуется';

export const FALLBACK_NOT_TRIGGERED_MESSAGE = 'доставка пришла не от B — фолбэк не сработал';

export const NO_A_ATTEMPT_MESSAGE = 'нет ни одной попытки доставки через поставщика A';

export const STUB_STATE_UNAVAILABLE_MESSAGE = '/_control/state недоступен';

export const NO_STUB_CONTROL_SKIP_MESSAGE = '--no-stub-control';

export const A_STOPPED_SKIP_MESSAGE = '--fail-mode stopped: /_control/state поставщика A недоступен';

export const DEMO_FAILED_MESSAGE = 'Ошибка прогона демо фолбэка:';

export const SCENARIOS_RESTORED_MESSAGE = 'Сценарии стендов поставщиков восстановлены в normal';

export const HELP_TEXT = `
Использование: npm run demo:fallback -- [опции]

Опциональные:
  --sku <sku>             SKU нового заказа, по умолчанию ${DEFAULT_SKU} (игнорируется вместе с --order)
  --order <ext_id>        прогнать демо против уже существующего заказа вместо создания нового
  --amount <число>        сумма в рублях (major units); по умолчанию — цена заказа
  --currency <код>        по умолчанию ${DEFAULT_CURRENCY}
  --fail-mode <mode>      как заваливает поставщик A: error_5xx|bad_request|stopped, по умолчанию error_5xx
  --api <url>             базовый URL API, по умолчанию $API_BASE_URL или ${DEFAULT_API_BASE_URL}
  --supplier-a <url>      базовый URL стенда поставщика A, по умолчанию $SUPPLIER_A_BASE_URL или ${DEFAULT_SUPPLIER_A_BASE_URL}
  --supplier-b <url>      базовый URL стенда поставщика B, по умолчанию $SUPPLIER_B_BASE_URL или ${DEFAULT_SUPPLIER_B_BASE_URL}
  --timeout-ms <число>    таймаут одного HTTP-запроса, по умолчанию ${DEFAULT_TIMEOUT_MS}
  --wait-ms <число>       максимальное время ожидания терминального статуса заказа, по умолчанию ${DEFAULT_WAIT_MS}
  --no-stub-control       не трогать /_control/scenario стендов поставщиков
  --reset-stubs           вызвать /_control/reset стендов поставщиков перед прогоном
  --help                  показать эту справку
`;
