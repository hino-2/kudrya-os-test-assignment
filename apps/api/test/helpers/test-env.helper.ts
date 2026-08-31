import {
  DATABASE_URL_VAR,
  DEFAULT_TEST_ENV,
  DESTRUCTIVE_TESTS_OPT_OUT,
  DESTRUCTIVE_TESTS_VAR,
  ENV_FILE,
  INVALID_DATABASE_URL_MESSAGE,
  LEADING_SLASH_PATTERN,
  MISSING_DATABASE_URL_MESSAGE,
  TEST_DATABASE_NAME_PATTERN,
  TEST_DATABASE_URL_VAR,
  UNSAFE_DATABASE_HINT,
  UNSAFE_DATABASE_MESSAGE,
} from './harness.constants';

function loadRepoEnvFile(): void {
  try {
    process.loadEnvFile(ENV_FILE);
  } catch {
    // .env отсутствует — не ошибка: переменные могут приходить прямо из окружения
  }
}

function readEnv(name: string): string | undefined {
  const value = process.env[name];

  return value === undefined || value === '' ? undefined : value;
}

function databaseNameOf(url: string): string {
  let parsed: URL;

  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`${INVALID_DATABASE_URL_MESSAGE}: "${url}"`);
  }

  const name = decodeURIComponent(parsed.pathname).replace(LEADING_SLASH_PATTERN, '');

  if (name === '') {
    throw new Error(`${INVALID_DATABASE_URL_MESSAGE}: "${url}"`);
  }

  return name;
}

function assertTestDatabase(url: string): void {
  const name = databaseNameOf(url);

  if (TEST_DATABASE_NAME_PATTERN.test(name) || readEnv(DESTRUCTIVE_TESTS_VAR) === DESTRUCTIVE_TESTS_OPT_OUT) {
    return;
  }

  throw new Error(`${UNSAFE_DATABASE_MESSAGE} "${name}". ${UNSAFE_DATABASE_HINT}`);
}

function applyDefaultTestEnv(): void {
  for (const [name, value] of Object.entries(DEFAULT_TEST_ENV)) {
    process.env[name] = value;
  }
}

export function applyTestEnv(): string {
  loadRepoEnvFile();

  const url = readEnv(TEST_DATABASE_URL_VAR) ?? readEnv(DATABASE_URL_VAR);

  if (url === undefined) {
    throw new Error(MISSING_DATABASE_URL_MESSAGE);
  }

  assertTestDatabase(url);

  process.env[DATABASE_URL_VAR] = url;
  applyDefaultTestEnv();

  return url;
}
