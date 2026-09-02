import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

import { FULFILLMENT_MODE } from '../catalog/catalog.constants';
import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import { InventoryRepository } from '../inventory/inventory.repository';
import type { IStockKeyRow } from '../inventory/inventory.interfaces';
import { LEDGER_TXN_KIND } from '../ledger/ledger.constants';
import { LedgerService } from '../ledger/ledger.service';
import { buildBalancedLegs, buildDeliveryRecognizedKey } from '../ledger/ledger.util';
import { ORDER_STATUS } from '../orders/orders.constants';
import { OrdersRepository } from '../orders/orders.repository';
import { DELIVERY_OUT_OF_STOCK_REASON, DELIVERY_OUTCOME, ISSUED_DELIVERY_LOST_MESSAGE } from './delivery.constants';
import { DeliveryRepository } from './delivery.repository';
import { buildOrderNotFoundMessage } from './delivery.util';
import type { IDeliveryResult, IFulfilInput, IFulfilmentService, ILockedOrderRow } from './delivery.interfaces';

@Injectable()
export class PoolFulfilmentService implements IFulfilmentService {
  readonly mode = FULFILLMENT_MODE.POOL;

  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly inventoryRepository: InventoryRepository,
    private readonly ordersRepository: OrdersRepository,
    private readonly ledgerService: LedgerService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('PoolFulfilmentService');
  }

  async fulfil(input: IFulfilInput): Promise<IDeliveryResult> {
    return this.unitOfWork.withTransaction((qr) => this.runTxP(qr, input));
  }

  private async runTxP(qr: QueryRunner, input: IFulfilInput): Promise<IDeliveryResult> {
    const order = await this.deliveryRepository.lockOrderForDelivery(qr, input.orderId);

    if (order === null) {
      throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND, buildOrderNotFoundMessage(input.orderId));
    }

    // просроченная генерация — заказ уже ушёл дальше (например, повторная выдача), задача не актуальна
    if (order.generation !== input.generation) {
      return { outcome: DELIVERY_OUTCOME.SKIPPED, code: null };
    }

    const idempotent = await this.handleTerminalStatus(qr, order);

    if (idempotent !== null) {
      return idempotent;
    }

    if (order.status !== ORDER_STATUS.PAID && order.status !== ORDER_STATUS.DELIVERING) {
      return { outcome: DELIVERY_OUTCOME.SKIPPED, code: null };
    }

    this.logger.event(LOG_EVENT.DELIVERY_STARTED, { order_id: order.id, generation: order.generation });

    if (order.status === ORDER_STATUS.PAID) {
      await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.PAID, ORDER_STATUS.DELIVERING, {});
    }

    const key = await this.reserveOrReuseKey(qr, order);

    if (key === null) {
      return this.drainToOutOfStock(qr, order);
    }

    const code = await this.issueDelivery(qr, order, key);

    await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERED, {
      deliveredAt: new Date(),
    });

    await this.ledgerService.postTxn(qr, {
      kind: LEDGER_TXN_KIND.DELIVERY_RECOGNIZED,
      idempotencyKey: buildDeliveryRecognizedKey(order.ext_id, order.generation),
      orderId: order.id,
      legs: buildBalancedLegs(LEDGER_TXN_KIND.DELIVERY_RECOGNIZED, order.amount_minor, order.currency, {
        orderId: order.id,
      }),
    });

    this.logger.event(LOG_EVENT.DELIVERY_COMPLETED, { order_id: order.id, generation: order.generation });

    return { outcome: DELIVERY_OUTCOME.DELIVERED, code };
  }

  // идемпотентные исходы для заказов, уже прошедших через доставку в предыдущей попытке
  private async handleTerminalStatus(qr: QueryRunner, order: ILockedOrderRow): Promise<IDeliveryResult | null> {
    if (order.status === ORDER_STATUS.DELIVERED) {
      const issued = await this.deliveryRepository.findIssuedDelivery(qr, order.id);

      return { outcome: DELIVERY_OUTCOME.ALREADY_DELIVERED, code: issued?.code ?? null };
    }

    if (order.status === ORDER_STATUS.OUT_OF_STOCK) {
      return { outcome: DELIVERY_OUTCOME.OUT_OF_STOCK, code: null };
    }

    return null;
  }

  private async reserveOrReuseKey(qr: QueryRunner, order: ILockedOrderRow): Promise<IStockKeyRow | null> {
    const existing = await this.inventoryRepository.findReservedKey(qr, order.id);

    if (existing !== null) {
      return existing;
    }

    const reserved = await this.inventoryRepository.reserveKey(qr, order.product_id, order.id);

    if (reserved === null) {
      return null;
    }

    await this.inventoryRepository.decrementAvailable(qr, order.product_id);

    return reserved;
  }

  private async drainToOutOfStock(qr: QueryRunner, order: ILockedOrderRow): Promise<IDeliveryResult> {
    await this.inventoryRepository.drainAvailable(qr, order.product_id);
    await this.inventoryRepository.syncProductInStock(qr, order.product_id);
    await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.DELIVERING, ORDER_STATUS.OUT_OF_STOCK, {
      failureReason: DELIVERY_OUT_OF_STOCK_REASON,
    });

    this.logger.event(LOG_EVENT.DELIVERY_OUT_OF_STOCK, { order_id: order.id, generation: order.generation });

    return { outcome: DELIVERY_OUTCOME.OUT_OF_STOCK, code: null };
  }

  private async issueDelivery(qr: QueryRunner, order: ILockedOrderRow, key: IStockKeyRow): Promise<string> {
    const existingIssued = await this.deliveryRepository.findIssuedDelivery(qr, order.id);

    if (existingIssued !== null) {
      return existingIssued.code;
    }

    const inserted = await this.deliveryRepository.insertIssuedDelivery(qr, {
      orderId: order.id,
      productId: order.product_id,
      sku: order.sku,
      code: key.code,
      stockKeyId: key.id,
    });
    // ON CONFLICT(order_id) DO NOTHING мог сработать из-за гонки — строка уже есть, перечитываем
    const row = inserted ?? (await this.deliveryRepository.findIssuedDelivery(qr, order.id));

    if (row === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, ISSUED_DELIVERY_LOST_MESSAGE);
    }

    const wasIssued = await this.inventoryRepository.markKeyIssued(qr, key.id);

    if (wasIssued) {
      await this.inventoryRepository.moveReservedToIssued(qr, order.product_id);
    }

    await this.inventoryRepository.syncProductInStock(qr, order.product_id);

    return row.code;
  }
}
