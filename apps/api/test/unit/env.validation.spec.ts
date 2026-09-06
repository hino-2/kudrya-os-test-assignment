import * as os from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  ADMIN_TOKEN_DEV_DEFAULT,
  ADMIN_TOKEN_MIN_LENGTH,
} from '../../src/common/config/config.constants';
import { defaultWorkerId, validateEnv } from '../../src/common/config/env.validation';

const VALID_ENV = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/store',
};

const PRODUCTION_ADMIN_ENV = { ...VALID_ENV, NODE_ENV: 'production', ADMIN_API_ENABLED: 'true' };

const STRONG_ADMIN_TOKEN = 'a'.repeat(ADMIN_TOKEN_MIN_LENGTH);

describe('validateEnv', () => {
  it('throws when the required DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrowError(/DATABASE_URL: обязательная переменная не задана/);
  });

  it('aggregates multiple simultaneous issues into a single error', () => {
    expect.assertions(4);

    try {
      validateEnv({ PORT: 'abc', LOG_LEVEL: 'trace' });
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toContain('DATABASE_URL');
      expect(message).toContain('PORT');
      expect(message).toContain('LOG_LEVEL');
      expect(message).toMatch(/^Некорректная конфигурация окружения \(3\):/);
    }
  });

  it('applies documented defaults for optional variables', () => {
    const env = validateEnv(VALID_ENV);

    expect(env.PORT).toBe(3000);
    expect(env.DB_POOL_SIZE).toBe(20);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.ADMIN_TOKEN).toBe(ADMIN_TOKEN_DEV_DEFAULT);
    expect(env.ADMIN_API_ENABLED).toBe(false);
  });

  it('rejects a non-integer PORT', () => {
    expect(() => validateEnv({ ...VALID_ENV, PORT: 'abc' })).toThrowError(/PORT/);
  });

  it('rejects a LOG_LEVEL value outside the enum', () => {
    expect(() => validateEnv({ ...VALID_ENV, LOG_LEVEL: 'trace' })).toThrowError(/LOG_LEVEL/);
  });

  it('falls back WORKER_ID to hostname:pid when empty', () => {
    const env = validateEnv({ ...VALID_ENV, WORKER_ID: '' });

    expect(env.WORKER_ID).toBe(`${os.hostname()}:${process.pid}`);
    expect(env.WORKER_ID).toBe(defaultWorkerId());
  });

  it('keeps ADMIN_TOKEN empty when explicitly set to empty (guard disabled)', () => {
    const env = validateEnv({ ...VALID_ENV, ADMIN_TOKEN: '' });

    expect(env.ADMIN_TOKEN).toBe('');
  });

  it('rejects an empty ADMIN_TOKEN in production while the admin API is enabled', () => {
    expect(() => validateEnv({ ...PRODUCTION_ADMIN_ENV, ADMIN_TOKEN: '' })).toThrowError(
      /ADMIN_TOKEN не может быть пустым/,
    );
  });

  it('rejects the published dev ADMIN_TOKEN in production', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION_ADMIN_ENV, ADMIN_TOKEN: ADMIN_TOKEN_DEV_DEFAULT }),
    ).toThrowError(/ADMIN_TOKEN не может совпадать с публичным дефолтом/);
  });

  // самый вероятный реальный триггер: деплой не задал переменную вовсе, и она разрешается
  // в публичный дефолт через resolveVar, а не через явно переданное значение
  it('rejects a missing ADMIN_TOKEN in production while the admin API is enabled', () => {
    expect(() => validateEnv({ ...PRODUCTION_ADMIN_ENV })).toThrowError(
      /ADMIN_TOKEN не может совпадать с публичным дефолтом/,
    );
  });

  it('rejects an ADMIN_TOKEN shorter than the minimum in production', () => {
    expect(() =>
      validateEnv({ ...PRODUCTION_ADMIN_ENV, ADMIN_TOKEN: STRONG_ADMIN_TOKEN.slice(1) }),
    ).toThrowError(
      new RegExp(`ADMIN_TOKEN должен быть не короче ${ADMIN_TOKEN_MIN_LENGTH} символов`),
    );
  });

  it('accepts a long non-default ADMIN_TOKEN in production', () => {
    const env = validateEnv({ ...PRODUCTION_ADMIN_ENV, ADMIN_TOKEN: STRONG_ADMIN_TOKEN });

    expect(env.ADMIN_TOKEN).toBe(STRONG_ADMIN_TOKEN);
    expect(env.ADMIN_API_ENABLED).toBe(true);
  });

  it('skips the ADMIN_TOKEN rule in production while the admin API stays disabled', () => {
    const env = validateEnv({ ...VALID_ENV, NODE_ENV: 'production', ADMIN_TOKEN: '' });

    expect(env.ADMIN_API_ENABLED).toBe(false);
    expect(env.ADMIN_TOKEN).toBe('');
  });

  it('rejects CATALOG_DEFAULT_LIMIT greater than CATALOG_MAX_LIMIT', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, CATALOG_DEFAULT_LIMIT: '200', CATALOG_MAX_LIMIT: '100' }),
    ).toThrowError(/CATALOG_DEFAULT_LIMIT/);
  });

  // M7: http_5xx больше не ждётся внутри прогона, поэтому каждая попытка к поставщику стоит
  // прогона джобы. Пара JOB_MAX_ATTEMPTS=2 / SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER=2 проходила
  // по отдельности, но убивала фолбэк A→B — до B дело просто не доходило
  it('rejects a JOB_MAX_ATTEMPTS budget too small to exhaust the supplier chain', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, JOB_MAX_ATTEMPTS: '2', SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER: '2' }),
    ).toThrowError(/JOB_MAX_ATTEMPTS должен быть не меньше 5/);
  });

  it('accepts the exact JOB_MAX_ATTEMPTS budget the supplier chain needs', () => {
    const env = validateEnv({
      ...VALID_ENV,
      JOB_MAX_ATTEMPTS: '5',
      SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER: '2',
    });

    expect(env.JOB_MAX_ATTEMPTS).toBe(5);
  });

  it('surfaces an unrelated scalar issue together with a cross-field violation in a single pass', () => {
    expect.assertions(3);

    try {
      validateEnv({
        ...VALID_ENV,
        PORT: 'abc',
        CATALOG_DEFAULT_LIMIT: '200',
        CATALOG_MAX_LIMIT: '100',
      });
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toContain('PORT');
      expect(message).toContain('CATALOG_DEFAULT_LIMIT');
      expect(message).toMatch(/^Некорректная конфигурация окружения \(2\):/);
    }
  });

  it('skips a cross-rule whose own field already failed coercion instead of double-reporting it', () => {
    expect.assertions(2);

    try {
      validateEnv({ ...VALID_ENV, CATALOG_DEFAULT_LIMIT: 'abc' });
    } catch (error) {
      const message = (error as Error).message;

      expect(message).toMatch(/^Некорректная конфигурация окружения \(1\):/);
      expect(message).toContain('CATALOG_DEFAULT_LIMIT');
    }
  });
});
