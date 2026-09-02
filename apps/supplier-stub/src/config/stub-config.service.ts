import { Injectable } from '@nestjs/common';

import {
  BOOL_FALSE_VALUES,
  BOOL_TRUE_VALUES,
  CONFIG_ERROR_HEADER,
  LOG_FORMATS,
  LOG_LEVELS,
  RATE_MAX,
  RATE_MIN,
  STUB_CONFIG_ENV_DEFAULTS,
  SUPPLIER_IDS,
} from './stub-config.constants';
import { readEnv } from './env-access.config';
import type { IEnvIssue, IStubConfig } from './stub-config.interfaces';
import type { SupplierId } from './stub-config.type';

function parseSupplierId(raw: string | undefined, issues: IEnvIssue[]): SupplierId {
  const value = raw ?? STUB_CONFIG_ENV_DEFAULTS.SUPPLIER_ID;

  if (!SUPPLIER_IDS.includes(value as SupplierId)) {
    issues.push({ name: 'SUPPLIER_ID', reason: `ожидалось A|B, получено "${value}"` });

    return STUB_CONFIG_ENV_DEFAULTS.SUPPLIER_ID as SupplierId;
  }

  return value as SupplierId;
}

function parseIntEnv(name: string, raw: string | undefined, fallback: number, issues: IEnvIssue[]): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isInteger(parsed)) {
    issues.push({ name, reason: `ожидалось целое число, получено "${raw}"` });

    return fallback;
  }

  return parsed;
}

function parseRateEnv(name: string, raw: string | undefined, fallback: number, issues: IEnvIssue[]): number {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed < RATE_MIN || parsed > RATE_MAX) {
    issues.push({ name, reason: `ожидалось число в диапазоне 0..1, получено "${raw}"` });

    return fallback;
  }

  return parsed;
}

function parseBoolEnv(name: string, raw: string | undefined, fallback: boolean, issues: IEnvIssue[]): boolean {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const normalized = raw.toLowerCase();

  if (BOOL_TRUE_VALUES.includes(normalized)) {
    return true;
  }

  if (BOOL_FALSE_VALUES.includes(normalized)) {
    return false;
  }

  issues.push({ name, reason: `ожидалось булево значение, получено "${raw}"` });

  return fallback;
}

function parseEnumEnv(name: string, raw: string | undefined, allowed: readonly string[], fallback: string, issues: IEnvIssue[]): string {
  if (raw === undefined || raw === '') {
    return fallback;
  }

  if (!allowed.includes(raw)) {
    issues.push({ name, reason: `ожидалось одно из [${allowed.join(', ')}], получено "${raw}"` });

    return fallback;
  }

  return raw;
}

function resolvePersistPath(raw: string | undefined, supplierId: SupplierId): string | null {
  if (raw === '') {
    return null;
  }

  if (raw === undefined) {
    return `./.stub-state-${supplierId}.json`;
  }

  return raw;
}

@Injectable()
export class StubConfigService {
  private readonly config: IStubConfig;

  constructor() {
    const env = readEnv();
    const issues: IEnvIssue[] = [];

    const supplierId = parseSupplierId(env.SUPPLIER_ID, issues);
    const port = parseIntEnv('PORT', env.PORT, STUB_CONFIG_ENV_DEFAULTS.PORT, issues);
    const inventorySize = parseIntEnv('STUB_INVENTORY_SIZE', env.STUB_INVENTORY_SIZE, STUB_CONFIG_ENV_DEFAULTS.STUB_INVENTORY_SIZE, issues);
    const failRate = parseRateEnv('STUB_FAIL_RATE', env.STUB_FAIL_RATE, STUB_CONFIG_ENV_DEFAULTS.STUB_FAIL_RATE, issues);
    const timeoutRate = parseRateEnv('STUB_TIMEOUT_RATE', env.STUB_TIMEOUT_RATE, STUB_CONFIG_ENV_DEFAULTS.STUB_TIMEOUT_RATE, issues);
    const slowRate = parseRateEnv('STUB_SLOW_RATE', env.STUB_SLOW_RATE, STUB_CONFIG_ENV_DEFAULTS.STUB_SLOW_RATE, issues);
    const latencyMinMs = parseIntEnv('STUB_LATENCY_MS_MIN', env.STUB_LATENCY_MS_MIN, STUB_CONFIG_ENV_DEFAULTS.STUB_LATENCY_MS_MIN, issues);
    const latencyMaxMs = parseIntEnv('STUB_LATENCY_MS_MAX', env.STUB_LATENCY_MS_MAX, STUB_CONFIG_ENV_DEFAULTS.STUB_LATENCY_MS_MAX, issues);
    const hangMs = parseIntEnv('STUB_HANG_MS', env.STUB_HANG_MS, STUB_CONFIG_ENV_DEFAULTS.STUB_HANG_MS, issues);
    const controlEnabled = parseBoolEnv('STUB_CONTROL_ENABLED', env.STUB_CONTROL_ENABLED, STUB_CONFIG_ENV_DEFAULTS.STUB_CONTROL_ENABLED, issues);
    const logLevel = parseEnumEnv('LOG_LEVEL', env.LOG_LEVEL, LOG_LEVELS, STUB_CONFIG_ENV_DEFAULTS.LOG_LEVEL, issues);
    const logFormat = parseEnumEnv('LOG_FORMAT', env.LOG_FORMAT, LOG_FORMATS, STUB_CONFIG_ENV_DEFAULTS.LOG_FORMAT, issues);
    const persistPath = resolvePersistPath(env.STUB_PERSIST_PATH, supplierId);

    if (latencyMinMs > latencyMaxMs) {
      issues.push({ name: 'STUB_LATENCY_MS_MIN', reason: 'STUB_LATENCY_MS_MIN не может превышать STUB_LATENCY_MS_MAX' });
    }

    if (issues.length > 0) {
      const message = `${CONFIG_ERROR_HEADER} (${issues.length}):\n${issues.map((issue) => `  - ${issue.name}: ${issue.reason}`).join('\n')}`;

      throw new Error(message);
    }

    this.config = Object.freeze({
      supplierId,
      port,
      inventorySize,
      failRate,
      timeoutRate,
      slowRate,
      latencyMinMs,
      latencyMaxMs,
      hangMs,
      persistPath,
      controlEnabled,
      logLevel,
      logFormat,
    });
  }

  get(): IStubConfig {
    return this.config;
  }
}
