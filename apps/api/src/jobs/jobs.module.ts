import { Module } from '@nestjs/common';

import { DeliverOrderHandler } from '../delivery/deliver-order.handler';
import { DeliveryModule } from '../delivery/delivery.module';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker.service';
import { JOB_HANDLERS } from './jobs.constants';
import type { IJobHandler } from './jobs.interfaces';

@Module({
  imports: [DeliveryModule],
  providers: [
    JobQueueService,
    JobHandlerRegistry,
    JobWorkerService,
    {
      provide: JOB_HANDLERS,
      useFactory: (deliverOrder: DeliverOrderHandler): readonly IJobHandler[] => [deliverOrder],
      inject: [DeliverOrderHandler],
    },
  ],
  exports: [JobQueueService, JobWorkerService, JobHandlerRegistry],
})
export class JobsModule {}
