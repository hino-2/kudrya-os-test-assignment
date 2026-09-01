import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentEventsRepository } from './payment-events.repository';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentWebhookService } from './payment-webhook.service';

@Module({
  imports: [OrdersModule, LedgerModule, JobsModule],
  controllers: [PaymentWebhookController],
  providers: [PaymentWebhookService, PaymentEventsRepository],
  exports: [PaymentWebhookService],
})
export class PaymentsModule {}
