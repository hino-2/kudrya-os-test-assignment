import * as fs from 'node:fs';

import { DataSource } from 'typeorm';

import { ENV_FILE_PATHS } from '../config/config.constants';
import type { IDbConfig } from '../config/config.interfaces';
import type { AppEnv } from '../config/config.type';
import { validateEnv } from '../config/env.validation';
import { buildDataSourceOptions } from './data-source.options';
import { registerPgTypeParsers } from './pg-types.util';

function loadAndValidateCliEnv(): AppEnv {
  const envFile = ENV_FILE_PATHS.find((path) => fs.existsSync(path));

  if (envFile !== undefined) {
    process.loadEnvFile(envFile);
  }

  return validateEnv(process.env);
}

function toDbConfig(env: AppEnv): IDbConfig {
  return {
    url: env.DATABASE_URL,
    poolSize: env.DB_POOL_SIZE,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
    txRetryAttempts: env.DB_TX_RETRY_ATTEMPTS,
  };
}

registerPgTypeParsers();

const env = loadAndValidateCliEnv();

export default new DataSource(buildDataSourceOptions(toDbConfig(env)));
