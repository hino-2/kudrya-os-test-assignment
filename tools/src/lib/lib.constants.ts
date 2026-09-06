import * as path from 'node:path';

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

export const ENV_FILE_NAME = '.env';

export const TX_BEGIN = 'BEGIN';

export const TX_COMMIT = 'COMMIT';

export const TX_ROLLBACK = 'ROLLBACK';

export const ENV_REQUIRED_MESSAGE = 'Обязательная переменная окружения не задана';

export const ENV_INT_MESSAGE = 'Ожидалось целое число в переменной окружения';

export const SAFE_INT_MESSAGE = 'Ожидалось целое число в безопасном диапазоне JS';

export const ENV_INT_DEFAULT_MIN = 0;

export const ENV_MIN_MESSAGE = 'Значение переменной окружения меньше допустимого минимума';

export const ARG_PREFIX = '--';

export const MISSING_ARG_MESSAGE = 'Обязательный аргумент командной строки не задан';

export const INVALID_INT_ARG_MESSAGE = 'Ожидалось целое число в аргументе командной строки';

export const MISSING_ARG_VALUE_MESSAGE = 'Аргумент командной строки задан без значения';

export const HTTP_METHOD = {
  GET: 'GET',
  POST: 'POST',
} as const;

export const DEFAULT_HTTP_TIMEOUT_MS = 5000;

export const HTTP_REQUEST_FAILED_MESSAGE = 'HTTP-запрос завершился ошибкой транспортного уровня';

export const HTTP_RESPONSE_NOT_JSON_MESSAGE = 'Тело ответа не является JSON';

export const CHECK_STATUS = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  SKIP: 'SKIP',
} as const;

export const CHECK_VERDICT = {
  PASS: 'PASS',
  FAIL: 'FAIL',
  INCONCLUSIVE: 'INCONCLUSIVE',
} as const;

// INCONCLUSIVE отделён от FAIL отдельным кодом: прогон ничего не опроверг, но и не проверил
// часть инвариантов (например, race --no-db пропускает все девять проверок по БД),
// поэтому читать его как успех нельзя
export const EXIT_CODE = {
  PASS: 0,
  FAIL: 1,
  INCONCLUSIVE: 2,
} as const;

export const VERDICT_LABEL = 'VERDICT';

export const INCONCLUSIVE_HINT =
  'часть проверок пропущена, прогон не доказывает инварианты целиком';

export const TABLE_COLUMN_GAP = '  ';

export const CHECK_TABLE_HEADERS = ['CHECK', 'STATUS', 'DETAIL'];
