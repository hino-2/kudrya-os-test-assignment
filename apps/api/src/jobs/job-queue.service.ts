import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { computeNextRunAt } from './backoff.util';
import {
  JOB_CLAIM_SQL,
  JOB_COMPLETE_SQL,
  JOB_ENQUEUE_SQL,
  JOB_FAIL_DEAD_SQL,
  JOB_FAIL_RETRY_SQL,
  JOB_RECLAIMED_STALE_LOCK_ERROR,
  JOB_REQUEUE_STALE_SQL,
  JOB_STATE,
  JOB_TRANSACTION_REQUIRED_MESSAGE,
} from './jobs.constants';
import type {
  IClaimJobsInput,
  IEnqueueJobInput,
  IJobFailureInput,
  IJobFailureResult,
  IJobIdRow,
  IJobRow,
} from './jobs.interfaces';
import type { UpdateReturningResult } from './jobs.type';
import { buildJobErrorText } from './jobs.util';

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

  async claim(qr: QueryRunner, input: IClaimJobsInput): Promise<IJobRow[]> {
    this.assertTransaction(qr);

    const [rows] = await this.dataSource.query<UpdateReturningResult<IJobRow>>(
      JOB_CLAIM_SQL,
      [input.workerId, input.limit],
      qr,
    );

    return rows ?? [];
  }

  async complete(qr: QueryRunner, id: number): Promise<boolean> {
    this.assertTransaction(qr);

    const [rows] = await this.dataSource.query<UpdateReturningResult<IJobIdRow>>(JOB_COMPLETE_SQL, [id], qr);

    return rows.length > 0;
  }

  async fail(qr: QueryRunner, input: IJobFailureInput): Promise<IJobFailureResult> {
    this.assertTransaction(qr);

    const truncatedError = buildJobErrorText(input.error);

    if (input.attempts >= input.maxAttempts) {
      await this.dataSource.query<UpdateReturningResult<IJobIdRow>>(
        JOB_FAIL_DEAD_SQL,
        [input.id, truncatedError],
        qr,
      );

      return { state: JOB_STATE.DEAD, runAt: null };
    }

    const runAt = computeNextRunAt(new Date(), input.attempts, input.backoff);

    await this.dataSource.query<UpdateReturningResult<IJobIdRow>>(
      JOB_FAIL_RETRY_SQL,
      [input.id, truncatedError, runAt],
      qr,
    );

    return { state: JOB_STATE.PENDING, runAt };
  }

  async requeueStale(qr: QueryRunner, lockTtlMs: number): Promise<number> {
    this.assertTransaction(qr);

    const [rows] = await this.dataSource.query<UpdateReturningResult<IJobIdRow>>(
      JOB_REQUEUE_STALE_SQL,
      [lockTtlMs, JOB_RECLAIMED_STALE_LOCK_ERROR],
      qr,
    );

    return rows.length;
  }

  private assertTransaction(qr: QueryRunner): void {
    if (!qr.isTransactionActive) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, JOB_TRANSACTION_REQUIRED_MESSAGE);
    }
  }
}
