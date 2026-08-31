import { Module, RequestMethod, ValidationPipe } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';

import { AppConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/db/database.module';
import { DomainErrorFilter } from './common/errors/domain-error.filter';
import { HealthModule } from './common/http/health.module';
import { VALIDATION_PIPE_OPTIONS } from './common/http/http.constants';
import { CorrelationMiddleware } from './common/logging/correlation.middleware';
import { LoggingModule } from './common/logging/logging.module';

@Module({
  imports: [AppConfigModule, LoggingModule, DatabaseModule, HealthModule],
  providers: [
    { provide: APP_PIPE, useFactory: () => new ValidationPipe(VALIDATION_PIPE_OPTIONS) },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
