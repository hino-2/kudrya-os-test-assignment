import { Module } from '@nestjs/common';

import { DeliveryModule } from '../delivery/delivery.module';
import { JobsModule } from '../jobs/jobs.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { SweeperService } from './sweeper.service';

@Module({
  imports: [OrdersModule, DeliveryModule, PaymentsModule, JobsModule],
  providers: [SweeperService],
  exports: [SweeperService],
})
export class ReconciliationModule {}
