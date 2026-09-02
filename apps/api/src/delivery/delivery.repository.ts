import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryRunner } from 'typeorm';

import type { FulfillmentMode } from '../catalog/catalog.type';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import {
  DELIVERY_TRANSACTION_REQUIRED_MESSAGE,
  FIND_FULFILLMENT_MODE_SQL,
  FIND_ISSUED_DELIVERY_SQL,
  INSERT_ISSUED_DELIVERY_SQL,
  INSERT_SUPPLIER_ISSUED_DELIVERY_SQL,
  LOCK_ORDER_FOR_DELIVERY_SQL,
} from './delivery.constants';
import type {
  IInsertIssuedDeliveryInput,
  IInsertSupplierIssuedDeliveryInput,
  IIssuedDeliveryRow,
  ILockedOrderRow,
} from './delivery.interfaces';

@Injectable()
export class DeliveryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async lockOrderForDelivery(qr: QueryRunner, orderId: number): Promise<ILockedOrderRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<ILockedOrderRow>(LOCK_ORDER_FOR_DELIVERY_SQL, [orderId], qr);

    return rows[0] ?? null;
  }

  async findFulfillmentMode(qr: QueryRunner, orderId: number): Promise<FulfillmentMode | null> {
    const rows = await this.run<{ fulfillment_mode: FulfillmentMode }>(FIND_FULFILLMENT_MODE_SQL, [orderId], qr);

    return rows[0]?.fulfillment_mode ?? null;
  }

  async findIssuedDelivery(qr: QueryRunner, orderId: number): Promise<IIssuedDeliveryRow | null> {
    const rows = await this.run<IIssuedDeliveryRow>(FIND_ISSUED_DELIVERY_SQL, [orderId], qr);

    return rows[0] ?? null;
  }

  async insertIssuedDelivery(qr: QueryRunner, input: IInsertIssuedDeliveryInput): Promise<IIssuedDeliveryRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<IIssuedDeliveryRow>(
      INSERT_ISSUED_DELIVERY_SQL,
      [input.orderId, input.productId, input.sku, input.code, input.stockKeyId],
      qr,
    );

    return rows[0] ?? null;
  }

  async insertSupplierIssuedDelivery(
    qr: QueryRunner,
    input: IInsertSupplierIssuedDeliveryInput,
  ): Promise<IIssuedDeliveryRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<IIssuedDeliveryRow>(
      INSERT_SUPPLIER_ISSUED_DELIVERY_SQL,
      [input.orderId, input.productId, input.sku, input.code, input.supplierCode, input.deliveryAttemptId],
      qr,
    );

    return rows[0] ?? null;
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
}
