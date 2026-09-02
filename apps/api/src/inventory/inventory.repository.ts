import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryResult, QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import {
  DECREMENT_AVAILABLE_SQL,
  DRAIN_AVAILABLE_SQL,
  FIND_RESERVED_KEY_SQL,
  INVENTORY_TRANSACTION_REQUIRED_MESSAGE,
  MARK_KEY_ISSUED_SQL,
  MOVE_RESERVED_TO_ISSUED_SQL,
  RESERVE_KEY_SQL,
  SYNC_PRODUCT_IN_STOCK_SQL,
} from './inventory.constants';
import type { IStockKeyRow } from './inventory.interfaces';

@Injectable()
export class InventoryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async reserveKey(qr: QueryRunner, productId: number, orderId: number): Promise<IStockKeyRow | null> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<IStockKeyRow>(RESERVE_KEY_SQL, [productId, orderId], qr);

    return rows[0] ?? null;
  }

  async findReservedKey(qr: QueryRunner, orderId: number): Promise<IStockKeyRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<IStockKeyRow>(FIND_RESERVED_KEY_SQL, [orderId], qr);

    return rows[0] ?? null;
  }

  async markKeyIssued(qr: QueryRunner, stockKeyId: number): Promise<boolean> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<IStockKeyRow>(MARK_KEY_ISSUED_SQL, [stockKeyId], qr);

    return rows.length > 0;
  }

  async decrementAvailable(qr: QueryRunner, productId: number): Promise<boolean> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<{ available_count: number }>(DECREMENT_AVAILABLE_SQL, [productId], qr);

    return rows.length > 0;
  }

  async moveReservedToIssued(qr: QueryRunner, productId: number): Promise<void> {
    this.assertTransaction(qr);
    await qr.query(MOVE_RESERVED_TO_ISSUED_SQL, [productId]);
  }

  async drainAvailable(qr: QueryRunner, productId: number): Promise<void> {
    this.assertTransaction(qr);
    await qr.query(DRAIN_AVAILABLE_SQL, [productId]);
  }

  async syncProductInStock(qr: QueryRunner, productId: number): Promise<void> {
    this.assertTransaction(qr);
    await qr.query(SYNC_PRODUCT_IN_STOCK_SQL, [productId]);
  }

  // FOR UPDATE SKIP LOCKED и CAS-UPDATE вне транзакции теряют блокировку на границе оператора.
  private assertTransaction(qr: QueryRunner): void {
    if (!qr.isTransactionActive) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, INVENTORY_TRANSACTION_REQUIRED_MESSAGE);
    }
  }

  private run<T>(sql: string, params: unknown[], qr?: QueryRunner): Promise<T[]> {
    return this.dataSource.query<T[]>(sql, params, qr);
  }

  private async runUpdate<T>(sql: string, params: unknown[], qr: QueryRunner): Promise<T[]> {
    const result: QueryResult<T> = await qr.query(sql, params, true);

    return result.records;
  }
}
