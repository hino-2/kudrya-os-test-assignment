import * as crypto from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import {
  LEDGER_ENTRIES_INSERT_SQL,
  LEDGER_TRANSACTION_REQUIRED_MESSAGE,
  LEDGER_TXN_INSERT_SQL,
} from './ledger.constants';
import type { IPostTxnInput, ITxnIdRow } from './ledger.interfaces';
import { assertPostableLegs, buildEntryParams } from './ledger.util';

@Injectable()
export class LedgerService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('LedgerService');
  }

  async postTxn(qr: QueryRunner, input: IPostTxnInput): Promise<string | null> {
    this.assertTransaction(qr);

    const currency = assertPostableLegs(input.legs);
    const txnId = crypto.randomUUID();
    const txnRows = await this.dataSource.query<ITxnIdRow[]>(
      LEDGER_TXN_INSERT_SQL,
      [txnId, input.kind, input.idempotencyKey, input.orderId],
      qr,
    );
    const inserted = txnRows[0];

    if (inserted === undefined) {
      // Повтор ключа идемпотентности — легитимный no-op, проводки писать нельзя.
      return null;
    }

    await this.dataSource.query(
      LEDGER_ENTRIES_INSERT_SQL,
      buildEntryParams(inserted.txn_id, currency, input.legs, input.orderId),
      qr,
    );

    this.logger.event(LOG_EVENT.LEDGER_TXN_POSTED, {
      txn_id: inserted.txn_id,
      kind: input.kind,
      idempotency_key: input.idempotencyKey,
      order_id: input.orderId,
      legs: input.legs.length,
      currency,
    });

    return inserted.txn_id;
  }

  private assertTransaction(qr: QueryRunner): void {
    if (!qr.isTransactionActive) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, LEDGER_TRANSACTION_REQUIRED_MESSAGE);
    }
  }
}
