import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { JOB_ENQUEUE_SQL, JOB_TRANSACTION_REQUIRED_MESSAGE } from './jobs.constants';
import type { IEnqueueJobInput, IJobIdRow } from './jobs.interfaces';

@Injectable()
export class JobQueueService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('JobQueueService');
  }

  async enqueue(qr: QueryRunner, input: IEnqueueJobInput): Promise<number | null> {
    this.assertTransaction(qr);

    const rows = await this.dataSource.query<IJobIdRow[]>(
      JOB_ENQUEUE_SQL,
      [input.kind, input.dedupeKey, JSON.stringify(input.payload), input.runAt, input.traceId],
      qr,
    );

    return rows[0]?.id ?? null;
  }

  private assertTransaction(qr: QueryRunner): void {
    if (!qr.isTransactionActive) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, JOB_TRANSACTION_REQUIRED_MESSAGE);
    }
  }
}
