export const API_BASE_URL_VAR = 'API_BASE_URL';

export const DEFAULT_API_BASE_URL = 'http://localhost:3000';

export const WEBHOOK_PAYMENT_PATH = '/webhooks/payment';

export const DEFAULT_CURRENCY = 'RUB';

export const DEFAULT_TIMEOUT_MS = 5000;

export const EVENT_ID_PREFIX = 'evt_cli_';

export const PAYMENT_STATUS = {
  PAID: 'paid',
  FAILED: 'failed',
} as const;

export const MISSING_REQUIRED_ARGS_MESSAGE = 'Обязательные аргументы не заданы: --order, --status, --amount';

export const INVALID_STATUS_MESSAGE = 'Недопустимое значение --status (ожидается paid|failed)';

export const INVALID_AMOUNT_MESSAGE = 'Некорректная сумма в --amount';

export const REQUEST_FAILED_MESSAGE = 'Вебхук не удалось доставить (транспортная ошибка)';

export const HELP_TEXT = `
Использование: npm run webhook -- --order <ext_id> --status <paid|failed> --amount <major> [опции]

Обязательные:
  --order <ext_id>        публичный идентификатор заказа, например ord_00123
  --status <paid|failed>  статус события
  --amount <число>        сумма в рублях (major units), не в копейках

Опциональные:
  --currency <код>        по умолчанию RUB
  --event <event_id>      по умолчанию генерируется evt_cli_<timestamp>
  --created-at <ISO8601>  по умолчанию текущее время
  --api <url>             базовый URL API, по умолчанию $API_BASE_URL или http://localhost:3000
  --timeout-ms <число>    таймаут HTTP-запроса, по умолчанию 5000
  --help                  показать эту справку
`;
