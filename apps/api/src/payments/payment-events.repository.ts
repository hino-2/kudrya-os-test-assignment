import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import {
  PAYMENT_EVENT_FINALISE_SQL,
  PAYMENT_EVENT_INSERT_SQL,
  PAYMENT_FIND_ABANDONABLE_ORPHANS_SQL,
  PAYMENT_FIND_REPLAYABLE_ORPHANS_SQL,
  PAYMENT_TRANSACTION_REQUIRED_MESSAGE,
} from './payments.constants';
import type {
  IOrphanEventRow,
  IPaymentEventFinalisation,
  IPaymentEventIdRow,
  IPaymentEventInput,
} from './payments.interfaces';

@Injectable()
export class PaymentEventsRepository {
  constructor(private readonly dataSource: DataSource) {}

  async insertPending(qr: QueryRunner, input: IPaymentEventInput): Promise<number | null> {
    this.assertTransaction(qr);

    const rows = await this.run<IPaymentEventIdRow>(
      PAYMENT_EVENT_INSERT_SQL,
      [
        input.eventId,
        input.orderExtId,
        input.status,
        input.amountMinor,
        input.currency,
        input.occurredAt,
        JSON.stringify(input.rawPayload),
        input.traceId,
      ],
      qr,
    );

    return rows[0]?.id ?? null;
  }

  async finalise(qr: QueryRunner, patch: IPaymentEventFinalisation): Promise<void> {
    this.assertTransaction(qr);

    await this.dataSource.query(
      PAYMENT_EVENT_FINALISE_SQL,
      [
        patch.id,
        patch.state,
        patch.orderId,
        patch.ignoreReason,
        patch.appliedFromStatus,
        patch.appliedToStatus,
      ],
      qr,
    );
  }

  async findReplayableOrphans(qr: QueryRunner, limit: number): Promise<IOrphanEventRow[]> {
    this.assertTransaction(qr);

    return this.run<IOrphanEventRow>(PAYMENT_FIND_REPLAYABLE_ORPHANS_SQL, [limit], qr);
  }

  async findAbandonableOrphans(qr: QueryRunner, ttlSeconds: number, limit: number): Promise<IPaymentEventIdRow[]> {
    this.assertTransaction(qr);

    return this.run<IPaymentEventIdRow>(PAYMENT_FIND_ABANDONABLE_ORPHANS_SQL, [ttlSeconds, limit], qr);
  }

  private assertTransaction(qr: QueryRunner): void {
    if (!qr.isTransactionActive) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, PAYMENT_TRANSACTION_REQUIRED_MESSAGE);
    }
  }

  private run<T>(sql: string, params: unknown[], qr?: QueryRunner): Promise<T[]> {
    return this.dataSource.query<T[]>(sql, params, qr);
  }
}
