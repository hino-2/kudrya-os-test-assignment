import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryResult, QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import {
  CLAIM_RESOLVABLE_UNKNOWN_ATTEMPTS_SQL,
  DELIVERY_TRANSACTION_REQUIRED_MESSAGE,
  DEMOTE_STALE_INFLIGHT_SQL,
  FIND_ATTEMPTS_BY_ORDER_SQL,
  FIND_OPEN_ATTEMPT_SQL,
  FINALIZE_ATTEMPT_FAILED_SQL,
  FINALIZE_ATTEMPT_SUCCEEDED_SQL,
  INSERT_DELIVERY_ATTEMPT_SQL,
  MARK_ATTEMPT_ABANDONED_SQL,
  PROMOTE_ATTEMPT_TO_UNKNOWN_SQL,
  RESUME_DELIVERY_ATTEMPT_SQL,
} from './delivery.constants';
import type {
  IDeliveryAttemptRow,
  IFinalizeAttemptFailedInput,
  IFinalizeAttemptSucceededInput,
  IInsertDeliveryAttemptInput,
  IPromoteAttemptToUnknownInput,
  IResolvableAttemptRow,
  IStaleInflightAttemptRow,
} from './delivery.interfaces';

@Injectable()
export class DeliveryAttemptRepository {
  constructor(private readonly dataSource: DataSource) {}

  async findOpenAttempt(qr: QueryRunner, orderId: number): Promise<IDeliveryAttemptRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<IDeliveryAttemptRow>(FIND_OPEN_ATTEMPT_SQL, [orderId], qr);

    return rows[0] ?? null;
  }

  async findAttemptsByOrder(
    qr: QueryRunner,
    orderId: number,
    deliveryGeneration: number,
  ): Promise<IDeliveryAttemptRow[]> {
    this.assertTransaction(qr);

    return this.run<IDeliveryAttemptRow>(
      FIND_ATTEMPTS_BY_ORDER_SQL,
      [orderId, deliveryGeneration],
      qr,
    );
  }

  // возвращает null при конфликте с открытой попыткой того же заказа (частичный уникальный
  // индекс delivery_attempts_open_uq) — вызывающий код обязан перечитать открытую попытку
  async insertAttempt(
    qr: QueryRunner,
    input: IInsertDeliveryAttemptInput,
  ): Promise<IDeliveryAttemptRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<IDeliveryAttemptRow>(
      INSERT_DELIVERY_ATTEMPT_SQL,
      [
        input.orderId,
        input.supplierCode,
        input.attemptNo,
        input.requestId,
        input.sku,
        input.deliveryGeneration,
      ],
      qr,
    );

    return rows[0] ?? null;
  }

  async resumeAttempt(qr: QueryRunner, attemptId: number): Promise<IDeliveryAttemptRow | null> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<IDeliveryAttemptRow>(
      RESUME_DELIVERY_ATTEMPT_SQL,
      [attemptId],
      qr,
    );

    return rows[0] ?? null;
  }

  async finalizeSucceeded(
    qr: QueryRunner,
    input: IFinalizeAttemptSucceededInput,
  ): Promise<boolean> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<{ id: number }>(
      FINALIZE_ATTEMPT_SUCCEEDED_SQL,
      [input.attemptId, input.httpStatus, input.responseCode, input.durationMs],
      qr,
    );

    return rows.length > 0;
  }

  async finalizeFailed(qr: QueryRunner, input: IFinalizeAttemptFailedInput): Promise<boolean> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<{ id: number }>(
      FINALIZE_ATTEMPT_FAILED_SQL,
      [input.attemptId, input.httpStatus, input.errorKind, input.errorReason, input.durationMs],
      qr,
    );

    return rows.length > 0;
  }

  // возвращает актуальное значение resolve_attempts после инкремента — вызывающий код сверяет
  // его с config.supplier.unknownMaxResolveAttempts, чтобы решить abandoned_unknown или нет
  async promoteToUnknown(
    qr: QueryRunner,
    input: IPromoteAttemptToUnknownInput,
  ): Promise<number | null> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<{ resolve_attempts: number }>(
      PROMOTE_ATTEMPT_TO_UNKNOWN_SQL,
      [input.attemptId, input.httpStatus, input.errorKind, input.errorReason, input.nextResolveAt],
      qr,
    );

    return rows[0]?.resolve_attempts ?? null;
  }

  // false означает, что попытку уже увёл кто-то другой (демоция свипером, второй воркер) —
  // вызывающий обязан проверить результат и не продолжать выдачу по чужой строке
  async markAbandoned(
    qr: QueryRunner,
    attemptId: number,
    resumedAt: Date | null,
  ): Promise<boolean> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<{ id: number }>(
      MARK_ATTEMPT_ABANDONED_SQL,
      [attemptId, resumedAt],
      qr,
    );

    return rows.length > 0;
  }

  async demoteStaleInFlight(
    qr: QueryRunner,
    timeoutMs: number,
    errorReason: string,
    limit: number,
  ): Promise<IStaleInflightAttemptRow[]> {
    this.assertTransaction(qr);

    return this.runUpdate<IStaleInflightAttemptRow>(
      DEMOTE_STALE_INFLIGHT_SQL,
      [timeoutMs, errorReason, limit],
      qr,
    );
  }

  // claim, а не чистое чтение: инкремент resolve_attempts и сдвиг next_resolve_at идут тем же
  // UPDATE … RETURNING, иначе pass 5b ставил бы одну и ту же джобу вечно (см. SQL-комментарий)
  async claimResolvableUnknown(
    qr: QueryRunner,
    retryMaxMs: number,
    maxResolveAttempts: number,
    limit: number,
  ): Promise<IResolvableAttemptRow[]> {
    this.assertTransaction(qr);

    return this.runUpdate<IResolvableAttemptRow>(
      CLAIM_RESOLVABLE_UNKNOWN_ATTEMPTS_SQL,
      [retryMaxMs, maxResolveAttempts, limit],
      qr,
    );
  }

  // CAS-транзиции и блокирующие SELECT вне транзакции теряют блокировку на границе оператора.
  private assertTransaction(qr: QueryRunner): void {
    if (!qr.isTransactionActive) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, DELIVERY_TRANSACTION_REQUIRED_MESSAGE);
    }
  }

  private run<T>(sql: string, params: unknown[], qr?: QueryRunner): Promise<T[]> {
    return this.dataSource.query<T[]>(sql, params, qr);
  }

  // Драйвер отдаёт UPDATE как [rows, rowCount], поэтому строки берутся из структурированного результата.
  private async runUpdate<T>(sql: string, params: unknown[], qr: QueryRunner): Promise<T[]> {
    const result = (await qr.query(sql, params, true)) as QueryResult<T>;

    return result.records;
  }
}
