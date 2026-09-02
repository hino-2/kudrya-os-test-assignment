import { Module, RequestMethod } from '@nestjs/common';
import type { MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { CatalogModule } from './catalog/catalog.module';
import { AppConfigModule } from './common/config/config.module';
import { DatabaseModule } from './common/db/database.module';
import { DomainErrorFilter } from './common/errors/domain-error.filter';
import { AppValidationPipe } from './common/http/app-validation.pipe';
import { HealthModule } from './common/http/health.module';
import { CorrelationMiddleware } from './common/logging/correlation.middleware';
import { LoggingModule } from './common/logging/logging.module';
import { DeliveryModule } from './delivery/delivery.module';
import { InventoryModule } from './inventory/inventory.module';
import { JobsModule } from './jobs/jobs.module';
import { LedgerModule } from './ledger/ledger.module';
import { OrdersModule } from './orders/orders.module';
import { PaymentsModule } from './payments/payments.module';

@Module({
  imports: [
    AppConfigModule,
    ScheduleModule.forRoot(),
    LoggingModule,
    DatabaseModule,
    HealthModule,
    CatalogModule,
    OrdersModule,
    LedgerModule,
    InventoryModule,
    DeliveryModule,
    JobsModule,
    PaymentsModule,
  ],
  providers: [
    { provide: APP_PIPE, useClass: AppValidationPipe },
    { provide: APP_FILTER, useClass: DomainErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationMiddleware).forRoutes({ path: '{*splat}', method: RequestMethod.ALL });
  }
}
