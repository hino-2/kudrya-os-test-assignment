import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { QueryResult, QueryRunner } from 'typeorm';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import {
  BUMP_AVAILABLE_COUNT_SQL,
  DECREMENT_AVAILABLE_SQL,
  FIND_RESERVED_KEY_SQL,
  INSERT_RESTOCK_KEYS_SQL,
  INVENTORY_COUNTER_DRIFT_MESSAGE,
  INVENTORY_TRANSACTION_REQUIRED_MESSAGE,
  LOCK_PRODUCT_STOCK_BY_SKU_SQL,
  LOCK_SKU_STOCK_SQL,
  MARK_KEY_ISSUED_SQL,
  MOVE_RESERVED_TO_ISSUED_SQL,
  RECOUNT_AVAILABLE_SQL,
  RESERVE_KEY_SQL,
  SYNC_PRODUCT_IN_STOCK_SQL,
} from './inventory.constants';
import type {
  ILockedProductStockRow,
  ISkuStockCountersRow,
  IStockKeyRow,
} from './inventory.interfaces';

@Injectable()
export class InventoryRepository {
  constructor(private readonly dataSource: DataSource) {}

  async reserveKey(
    qr: QueryRunner,
    productId: number,
    orderId: number,
  ): Promise<IStockKeyRow | null> {
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

  // счётчик кламплится, а не охраняется: выигранный ключ обязан быть выдан даже при
  // разошедшемся зеркале (см. DECREMENT_AVAILABLE_SQL). 0 строк здесь означает отсутствие
  // строки sku_stock — доставку это не отменяет, расхождение сойдётся на следующем пересчёте
  async decrementAvailable(qr: QueryRunner, productId: number): Promise<void> {
    this.assertTransaction(qr);
    await this.runUpdate<ISkuStockCountersRow>(DECREMENT_AVAILABLE_SQL, [productId], qr);
  }

  async moveReservedToIssued(qr: QueryRunner, productId: number): Promise<void> {
    this.assertTransaction(qr);
    await this.runUpdate<ISkuStockCountersRow>(MOVE_RESERVED_TO_ISSUED_SQL, [productId], qr);
  }

  // блокировка берётся отдельным оператором до пересчёта — иначе снапшот подзапроса не
  // продвинется через ожидание блокировки и пересчёт затрёт закоммиченный restock
  // (см. LOCK_SKU_STOCK_SQL). Отсутствие строки sku_stock — не ошибка: это путь «остатка нет»,
  // и падать здесь означало бы уронить джобу вместо чистого перехода в out_of_stock
  async recountAvailable(qr: QueryRunner, productId: number): Promise<number> {
    this.assertTransaction(qr);
    await this.run(LOCK_SKU_STOCK_SQL, [productId], qr);

    const rows = await this.runUpdate<ISkuStockCountersRow>(RECOUNT_AVAILABLE_SQL, [productId], qr);

    return rows[0]?.available_count ?? 0;
  }

  // блокировка та же и по той же причине, что в recountAvailable: этот UPDATE держит products,
  // а читает sku_stock, и на пути переиспользования ключа (findReservedKey — в транзакции нет
  // своей записи в sku_stock) ожидание блокировки products дало бы in_stock = false поверх
  // только что закоммиченного restock. На остальных путях это безобидный повторный захват.
  async syncProductInStock(qr: QueryRunner, productId: number): Promise<void> {
    this.assertTransaction(qr);
    await this.run(LOCK_SKU_STOCK_SQL, [productId], qr);
    await qr.query(SYNC_PRODUCT_IN_STOCK_SQL, [productId]);
  }

  async lockProductStockBySku(
    qr: QueryRunner,
    sku: string,
  ): Promise<ILockedProductStockRow | null> {
    this.assertTransaction(qr);

    const rows = await this.run<ILockedProductStockRow>(LOCK_PRODUCT_STOCK_BY_SKU_SQL, [sku], qr);

    return rows[0] ?? null;
  }

  async insertRestockKeys(
    qr: QueryRunner,
    productId: number,
    codes: string[],
    batch: string,
  ): Promise<number> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<IStockKeyRow>(
      INSERT_RESTOCK_KEYS_SQL,
      [productId, codes, batch],
      qr,
    );

    return rows.length;
  }

  // вызывающий уже доказал существование строки sku_stock под FOR UPDATE (lockProductStockBySku)
  // в этой же транзакции, поэтому пустой RETURNING здесь — расхождение, а не «товара нет»
  async bumpAvailableCount(qr: QueryRunner, productId: number, delta: number): Promise<number> {
    this.assertTransaction(qr);

    const rows = await this.runUpdate<ISkuStockCountersRow>(
      BUMP_AVAILABLE_COUNT_SQL,
      [productId, delta],
      qr,
    );

    this.assertCounterApplied(rows);

    return rows[0].available_count ?? 0;
  }

  // остался единственным потребителем — bumpAvailableCount, где вызывающий уже доказал
  // существование строки под FOR UPDATE, поэтому 0 строк там означает расхождение, а не
  // «товара нет». Вызывает его только admin-эндпоинт, то есть последствие — 500 на restock
  private assertCounterApplied(rows: ISkuStockCountersRow[]): void {
    if (rows.length === 0) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, INVENTORY_COUNTER_DRIFT_MESSAGE);
    }
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
    const result = (await qr.query(sql, params, true)) as QueryResult<T>;

    return result.records;
  }
}
