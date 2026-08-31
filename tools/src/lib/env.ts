import * as path from 'node:path';

import {
  ENV_FILE_NAME,
  ENV_INT_DEFAULT_MIN,
  ENV_INT_MESSAGE,
  ENV_MIN_MESSAGE,
  ENV_REQUIRED_MESSAGE,
  REPO_ROOT,
} from './lib.constants';

export function loadDotEnv(): void {
  try {
    process.loadEnvFile(path.join(REPO_ROOT, ENV_FILE_NAME));
  } catch {
    return;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];

  if (value === undefined || value === '') {
    throw new Error(`${ENV_REQUIRED_MESSAGE}: ${name}`);
  }

  return value;
}

export function intEnv(name: string, fallback: number, min: number = ENV_INT_DEFAULT_MIN): number {
  const raw = process.env[name];

  if (raw === undefined || raw === '') {
    return fallback;
  }

  const parsed = Number(raw);

  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`${ENV_INT_MESSAGE}: ${name}="${raw}"`);
  }

  if (parsed < min) {
    throw new Error(`${ENV_MIN_MESSAGE}: ${name}="${raw}", минимум ${min}`);
  }

  return parsed;
}
