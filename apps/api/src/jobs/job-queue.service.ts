import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import { AppConfigService } from '../common/config/app-config.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
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
    private readonly config: AppConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('JobQueueService');
  }

  // null означает, что ON CONFLICT (kind, dedupe_key) WHERE state IN ('pending','running')
  // отбросил вставку: живая джоба уже есть, и она может нести устаревшее поколение. Каждый
  // вызывающий обязан ветвиться на null, поэтому предупреждение пишется здесь — одним местом
  // на все пути постановки
  async enqueue(qr: QueryRunner, input: IEnqueueJobInput): Promise<number | null> {
    this.assertTransaction(qr);

    const rows = await this.dataSource.query<IJobIdRow[]>(
      JOB_ENQUEUE_SQL,
      [
        input.kind,
        input.dedupeKey,
        JSON.stringify(input.payload),
        input.runAt,
        input.traceId,
        input.maxAttempts ?? this.config.jobs.maxAttempts,
      ],
      qr,
    );
    const id = rows[0]?.id ?? null;

    if (id === null) {
      this.logger.event(LOG_EVENT.JOB_ENQUEUE_SKIPPED, { kind: input.kind, dedupe_key: input.dedupeKey });
    }

    return id;
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

  async complete(qr: QueryRunner, id: number, lockedBy: string | null): Promise<boolean> {
    this.assertTransaction(qr);

    const [rows] = await this.dataSource.query<UpdateReturningResult<IJobIdRow>>(
      JOB_COMPLETE_SQL,
      [id, lockedBy],
      qr,
    );

    return rows.length > 0;
  }

  async fail(qr: QueryRunner, input: IJobFailureInput): Promise<IJobFailureResult> {
    this.assertTransaction(qr);

    const truncatedError = buildJobErrorText(input.error);

    if (input.attempts >= input.maxAttempts) {
      const [deadRows] = await this.dataSource.query<UpdateReturningResult<IJobIdRow>>(
        JOB_FAIL_DEAD_SQL,
        [input.id, truncatedError, input.lockedBy],
        qr,
      );

      return { state: JOB_STATE.DEAD, runAt: null, applied: deadRows.length > 0 };
    }

    const runAt = computeNextRunAt(new Date(), input.attempts, input.backoff);

    const [retryRows] = await this.dataSource.query<UpdateReturningResult<IJobIdRow>>(
      JOB_FAIL_RETRY_SQL,
      [input.id, truncatedError, runAt, input.lockedBy],
      qr,
    );

    return { state: JOB_STATE.PENDING, runAt, applied: retryRows.length > 0 };
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
