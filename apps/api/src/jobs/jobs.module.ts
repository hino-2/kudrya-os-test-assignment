import { Module } from '@nestjs/common';

import { JobHandlerRegistry } from './job-handler.registry';
import { JobQueueService } from './job-queue.service';
import { JobWorkerService } from './job-worker.service';
import { JOB_HANDLERS } from './jobs.constants';
import type { IJobHandler } from './jobs.interfaces';

@Module({
  providers: [
    JobQueueService,
    JobHandlerRegistry,
    JobWorkerService,
    { provide: JOB_HANDLERS, useFactory: (): readonly IJobHandler[] => [] },
  ],
  exports: [JobQueueService, JobWorkerService, JobHandlerRegistry],
})
export class JobsModule {}
