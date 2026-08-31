import 'reflect-metadata';

import { NestFactory } from '@nestjs/core';

import { AppModule } from './app.module';
import { AppConfigService } from './common/config/app-config.service';
import { BIND_HOST } from './common/http/http.constants';
import { JsonLogger } from './common/logging/json-logger';
import { FALLBACK_LOGGER_OPTIONS, JSON_LOGGER, LOG_EVENT } from './common/logging/logging.constants';

function registerProcessGuards(logger: JsonLogger): void {
  process.on('uncaughtException', (error: Error) => {
    logger.write({ level: 'error', event: LOG_EVENT.APP_UNCAUGHT_EXCEPTION, ctx: 'Process', err: error });
    process.exit(1);
  });

  process.on('unhandledRejection', (reason: unknown) => {
    logger.write({ level: 'error', event: LOG_EVENT.APP_UNHANDLED_REJECTION, ctx: 'Process', err: reason });
  });
}

function handleBootFailure(error: unknown): never {
  const fallbackLogger = new JsonLogger(FALLBACK_LOGGER_OPTIONS);

  fallbackLogger.write({ level: 'error', event: LOG_EVENT.APP_BOOT_FAILED, ctx: 'Bootstrap', err: error });
  process.exit(1);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true, abortOnError: false, autoFlushLogs: false });
  const logger = app.get<JsonLogger>(JSON_LOGGER);

  app.useLogger(logger);
  app.flushLogs();
  registerProcessGuards(logger);
  app.enableShutdownHooks();

  const config = app.get(AppConfigService);

  await app.listen(config.http.port, BIND_HOST);

  logger.write({
    level: 'info',
    event: LOG_EVENT.APP_STARTED,
    ctx: 'Bootstrap',
    data: {
      port: config.http.port,
      node_env: config.http.nodeEnv,
      log_level: config.logging.level,
      worker_enabled: config.jobs.workerEnabled,
    },
  });
}

bootstrap().catch(handleBootFailure);
