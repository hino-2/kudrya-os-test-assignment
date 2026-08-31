import * as os from 'node:os';

import { describe, expect, it } from 'vitest';

import { defaultWorkerId, validateEnv } from '../../src/common/config/env.validation';

const VALID_ENV = {
  DATABASE_URL: 'postgres://postgres:postgres@localhost:5432/store',
};

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
    expect(env.ADMIN_TOKEN).toBe('dev-admin-token');
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

  it('rejects CATALOG_DEFAULT_LIMIT greater than CATALOG_MAX_LIMIT', () => {
    expect(() =>
      validateEnv({ ...VALID_ENV, CATALOG_DEFAULT_LIMIT: '200', CATALOG_MAX_LIMIT: '100' }),
    ).toThrowError(/CATALOG_DEFAULT_LIMIT/);
  });

  it('surfaces an unrelated scalar issue together with a cross-field violation in a single pass', () => {
    expect.assertions(3);

    try {
      validateEnv({ ...VALID_ENV, PORT: 'abc', CATALOG_DEFAULT_LIMIT: '200', CATALOG_MAX_LIMIT: '100' });
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
