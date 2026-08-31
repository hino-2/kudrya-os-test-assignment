import type { ValidationPipeOptions } from '@nestjs/common';

export const SERVICE_NAME = 'api';

export const APP_VERSION = '1.0.0';

export const BIND_HOST = '0.0.0.0';

export const HEALTH_ROUTE = 'health';

export const READINESS_COMPONENT = {
  DB: 'db',
  WORKER: 'worker',
  LEDGER: 'ledger',
} as const;

export const READINESS_QUERY = 'SELECT 1';

export const READINESS_OK_STATUS = 200;

export const READINESS_DEGRADED_STATUS = 503;

export const VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: false },
  stopAtFirstError: false,
};
