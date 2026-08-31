import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { AppConfigService } from '../config/app-config.service';
import { AppLoggerService } from '../logging/app-logger.service';
import { LOG_EVENT } from '../logging/logging.constants';
import { ISOLATION_LEVEL, TX_RETRY_BASE_DELAY_MS, TX_RETRY_JITTER_MS } from './db.constants';
import type { IUnitOfWorkOptions } from './db.interfaces';
import type { TransactionWork } from './db.type';
import { isRetryableTxError, pgErrorCode } from './pg-error.util';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class UnitOfWorkService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly config: AppConfigService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('UnitOfWorkService');
  }

  async withTransaction<T>(work: TransactionWork<T>, options?: IUnitOfWorkOptions): Promise<T> {
    const maxAttempts = options?.retryAttempts ?? this.config.db.txRetryAttempts;

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.runOnce(work, options?.isolationLevel);
      } catch (error) {
        if (!isRetryableTxError(error) || attempt >= maxAttempts) {
          throw error;
        }

        const delayMs = TX_RETRY_BASE_DELAY_MS * 2 ** attempt + Math.random() * TX_RETRY_JITTER_MS;

        this.logger.event(LOG_EVENT.DB_SERIALIZATION_RETRY, { attempt, sqlstate: pgErrorCode(error) });
        await sleep(delayMs);
      }
    }
  }

  private async runOnce<T>(work: TransactionWork<T>, isolationLevel?: IUnitOfWorkOptions['isolationLevel']): Promise<T> {
    const queryRunner = this.dataSource.createQueryRunner();

    await queryRunner.connect();
    await queryRunner.startTransaction(isolationLevel ?? ISOLATION_LEVEL);

    try {
      const result = await work(queryRunner);

      await queryRunner.commitTransaction();

      return result;
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
