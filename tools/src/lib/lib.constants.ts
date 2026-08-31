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
