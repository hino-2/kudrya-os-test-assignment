import { Global, Module } from '@nestjs/common';

import { AppConfigService } from '../config/app-config.service';
import { AppLoggerService } from './app-logger.service';
import { CorrelationMiddleware } from './correlation.middleware';
import { CorrelationStore } from './correlation.store';
import { JsonLogger } from './json-logger';
import { JSON_LOGGER } from './logging.constants';

@Global()
@Module({
  providers: [
    CorrelationStore,
    {
      provide: JSON_LOGGER,
      useFactory: (config: AppConfigService, store: CorrelationStore) => new JsonLogger(config.logging, store),
      inject: [AppConfigService, CorrelationStore],
    },
    AppLoggerService,
    CorrelationMiddleware,
  ],
  exports: [CorrelationStore, JSON_LOGGER, AppLoggerService, CorrelationMiddleware],
})
export class LoggingModule {}
