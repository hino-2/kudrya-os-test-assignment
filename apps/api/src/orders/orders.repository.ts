import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryResult, QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import {
  ORDER_DELIVERY_ATTEMPTS_SQL,
  ORDER_DELIVERY_SQL,
  ORDER_EXT_ID_LOST_MESSAGE,
  ORDER_FIND_RETRYABLE_DELIVERY_FAILED_SQL,
  ORDER_FIND_RETRYABLE_OUT_OF_STOCK_SQL,
  ORDER_FIND_STUCK_PAID_DELIVERING_SQL,
  ORDER_INSERT_SQL,
  ORDER_LOCK_BY_EXT_ID_SQL,
  ORDER_NEXT_EXT_ID_SQL,
  ORDER_PAYMENT_EVENTS_SQL,
  ORDER_PRODUCT_SNAPSHOT_SQL,
  ORDER_SELECT_BY_EXT_ID_SQL,
  ORDER_TRANSACTION_REQUIRED_MESSAGE,
  ORDER_TRANSITION_SQL,
} from './orders.constants';
import type {
  IDeliveryAttemptRow,
  IExtIdRow,
  IIssuedDeliveryRow,
  IOrderDraft,
  IOrderMutablePatch,
  IOrderRow,
  IPaymentEventRow,
  IProductSnapshotRow,
  IRecoverableOrderRow,
  IStuckDeliveryOrderRow,
} from './orders.interfaces';
import type { OrderStatus } from './orders.type';

@Injectable()
export class OrdersRepository {
  constructor(private readonly dataSource: DataSource) {}

  async nextExtId(qr: QueryRunner): Promise<string> {
    const rows = await this.run<IExtIdRow>(ORDER_NEXT_EXT_ID_SQL, [], qr);
    const row = rows[0];

    if (row === undefined) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, ORDER_EXT_ID_LOST_MESSAGE);
    }

    return row.ext_id;
  }

  async findProductBySku(qr: QueryRunner, sku: string): Promise<IProductSnapshotRow | null> {
    const rows = await this.run<IProductSnapshotRow>(ORDER_PRODUCT_SNAPSHOT_SQL, [sku], qr);

    return rows[0] ?? null;
  }

  async insert(qr: QueryRunner, draft: IOrderDraft): Promise<IOrderRow | null> {
    const rows = await this.run<IOrderRow>(
      ORDER_INSERT_SQL,
      [
        draft.extId,
        draft.productId,
        draft.sku,
        draft.quantity,
        draft.unitPriceMinor,
        draft.totalMinor,
        draft.currency,
        draft.buyerEmail,
      ],
      qr,
    );

    return rows[0] ?? null;
  }

  async findByExtId(extId: string, qr?: QueryRunner): Promise<IOrderRow | null> {
    const rows = await this.run<IOrderRow>(ORDER_SELECT_BY_EXT_ID_SQL, [extId], qr);

    return rows[0] ?? null;
  }

  async lockForUpdate(qr: QueryRunner, extId: string): Promise<IOrderRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<IOrderRow>(ORDER_LOCK_BY_EXT_ID_SQL, [extId], qr);

    return rows[0] ?? null;
  }

  async transition(
    qr: QueryRunner,
    orderId: number,
    from: OrderStatus,
    to: OrderStatus,
    patch: IOrderMutablePatch,
  ): Promise<IOrderRow | null> {
    this.assertTransaction(qr);

    // failure_reason присваивается без COALESCE: пропуск поля стирает устаревшую причину отказа.
    const rows = await this.runUpdate<IOrderRow>(
      ORDER_TRANSITION_SQL,
      [
        orderId,
        from,
        to,
        patch.paidAt ?? null,
        patch.deliveringAt ?? null,
        patch.deliveredAt ?? null,
        patch.failureReason ?? null,
        patch.deliveryGeneration ?? null,
        patch.lastPaymentEventId ?? null,
        patch.lastPaymentEventAt ?? null,
      ],
      qr,
    );

    return rows[0] ?? null;
  }

  async findDelivery(orderId: number): Promise<IIssuedDeliveryRow | null> {
    const rows = await this.run<IIssuedDeliveryRow>(ORDER_DELIVERY_SQL, [orderId]);

    return rows[0] ?? null;
  }

  async findRecentPaymentEvents(orderId: number, limit: number): Promise<IPaymentEventRow[]> {
    return this.run<IPaymentEventRow>(ORDER_PAYMENT_EVENTS_SQL, [orderId, limit]);
  }

  async findDeliveryAttempts(orderId: number): Promise<IDeliveryAttemptRow[]> {
    return this.run<IDeliveryAttemptRow>(ORDER_DELIVERY_ATTEMPTS_SQL, [orderId]);
  }

  async findStuckPaidDelivering(qr: QueryRunner, ageSeconds: number, limit: number): Promise<IStuckDeliveryOrderRow[]> {
    this.assertTransaction(qr);

    return this.run<IStuckDeliveryOrderRow>(ORDER_FIND_STUCK_PAID_DELIVERING_SQL, [ageSeconds, limit], qr);
  }

  async findRetryableOutOfStock(qr: QueryRunner, limit: number): Promise<IRecoverableOrderRow[]> {
    this.assertTransaction(qr);

    return this.run<IRecoverableOrderRow>(ORDER_FIND_RETRYABLE_OUT_OF_STOCK_SQL, [limit], qr);
  }

  async findRetryableDeliveryFailed(
    qr: QueryRunner,
    retrySeconds: number,
    maxGenerations: number,
    limit: number,
  ): Promise<IRecoverableOrderRow[]> {
    this.assertTransaction(qr);

    return this.run<IRecoverableOrderRow>(
      ORDER_FIND_RETRYABLE_DELIVERY_FAILED_SQL,
      [retrySeconds, maxGenerations, limit],
      qr,
    );
  }

  // FOR UPDATE и CAS-UPDATE вне транзакции теряют блокировку на границе оператора.
  private assertTransaction(qr: QueryRunner): void {
    if (!qr.isTransactionActive) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, ORDER_TRANSACTION_REQUIRED_MESSAGE);
    }
  }

  private run<T>(sql: string, params: unknown[], qr?: QueryRunner): Promise<T[]> {
    return this.dataSource.query<T[]>(sql, params, qr);
  }

  // Драйвер отдаёт UPDATE как [rows, rowCount], поэтому строки берутся из структурированного результата.
  private async runUpdate<T>(sql: string, params: unknown[], qr: QueryRunner): Promise<T[]> {
    const result: QueryResult<T> = await qr.query(sql, params, true);

    return result.records;
  }
}
