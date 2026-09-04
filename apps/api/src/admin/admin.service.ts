import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';

import { FULFILLMENT_MODE } from '../catalog/catalog.constants';
import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import { RESTOCK_BATCH } from '../inventory/inventory.constants';
import { InventoryRepository } from '../inventory/inventory.repository';
import { JobQueueService } from '../jobs/job-queue.service';
import { JOB_KIND } from '../jobs/jobs.constants';
import type { IDeliverOrderPayload } from '../jobs/jobs.interfaces';
import { buildDeliverOrderDedupeKey } from '../jobs/jobs.util';
import { isRecoverable, resolveTransition } from '../orders/order-state-machine';
import { ORDER_EVENT, TRANSITION_KIND } from '../orders/orders.constants';
import { OrdersRepository } from '../orders/orders.repository';
import { SweeperService } from '../reconciliation/sweeper.service';
import type { ISweeperCycleResult } from '../reconciliation/sweeper.interfaces';
import { SupplierClient } from '../suppliers/supplier.client';
import { RESTOCK_BODY_INVALID_MESSAGE, RESTOCK_SUPPLIER_CODES_UNSUPPORTED_MESSAGE } from './admin.constants';
import type { IRedeliverInput, IRedeliverResult, IRestockInput, IRestockResult } from './admin.interfaces';

@Injectable()
export class AdminService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly inventory: InventoryRepository,
    private readonly orders: OrdersRepository,
    private readonly jobQueue: JobQueueService,
    private readonly supplierClient: SupplierClient,
    private readonly sweeper: SweeperService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('AdminService');
  }

  async runSweeperCycle(): Promise<ISweeperCycleResult> {
    return this.sweeper.runOnce();
  }

  async restock(input: IRestockInput): Promise<IRestockResult> {
    const hasCodes = input.codes !== undefined;
    const hasCount = input.count !== undefined;

    if (hasCodes === hasCount) {
      throw new DomainError(ERROR_CODE.VALIDATION_FAILED, RESTOCK_BODY_INVALID_MESSAGE);
    }

    let supplierRestockCount: number | null = null;

    const result = await this.unitOfWork.withTransaction(async (qr) => {
      const product = await this.inventory.lockProductStockBySku(qr, input.sku);

      if (product === null) {
        throw new DomainError(ERROR_CODE.PRODUCT_NOT_FOUND);
      }

      if (product.fulfillment_mode === FULFILLMENT_MODE.SUPPLIER) {
        if (hasCodes) {
          throw new DomainError(ERROR_CODE.VALIDATION_FAILED, RESTOCK_SUPPLIER_CODES_UNSUPPORTED_MESSAGE);
        }

        // count проверен выше через hasCount === !hasCodes
        const count = input.count as number;
        const availableCount = await this.inventory.bumpAvailableCount(qr, product.id, count);

        await this.inventory.syncProductInStock(qr, product.id);
        supplierRestockCount = count;

        return { added: count, availableCount };
      }

      const codes = hasCodes ? (input.codes as string[]) : this.generatePoolCodes(input.count as number);
      const insertedCount = await this.inventory.insertRestockKeys(qr, product.id, codes, RESTOCK_BATCH);
      const availableCount = await this.inventory.bumpAvailableCount(qr, product.id, insertedCount);

      await this.inventory.syncProductInStock(qr, product.id);

      return { added: insertedCount, availableCount };
    });

    // вызов поставщика — сайд-эффект, идёт после коммита, чтобы не держать TX открытой на время сети
    if (supplierRestockCount !== null) {
      await this.supplierClient.restock(supplierRestockCount);
    }

    this.logger.event(LOG_EVENT.ADMIN_RESTOCK, { sku: input.sku, added: result.added, available_count: result.availableCount });

    return { added: result.added, availableCount: result.availableCount };
  }

  async redeliver(input: IRedeliverInput): Promise<IRedeliverResult> {
    const result = await this.unitOfWork.withTransaction(async (qr) => {
      const order = await this.orders.lockForUpdate(qr, input.orderId);

      if (order === null) {
        throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND);
      }

      const delivery = await this.orders.findDelivery(order.id);

      if (delivery !== null) {
        throw new DomainError(ERROR_CODE.ORDER_ALREADY_DELIVERED);
      }

      if (!isRecoverable(order.status)) {
        throw new DomainError(ERROR_CODE.ORDER_NOT_RECOVERABLE);
      }

      const rule = resolveTransition(order.status, ORDER_EVENT.ADMIN_REDELIVER);

      if (rule.kind !== TRANSITION_KIND.APPLY) {
        throw new DomainError(ERROR_CODE.ORDER_NOT_RECOVERABLE);
      }

      const updated = await this.orders.transition(qr, order.id, order.status, rule.to, {
        deliveryGeneration: order.delivery_generation + 1,
      });

      if (updated === null) {
        throw new DomainError(ERROR_CODE.ORDER_NOT_RECOVERABLE);
      }

      const payload = {
        orderId: updated.id,
        ext_id: updated.ext_id,
        generation: updated.delivery_generation,
      } satisfies IDeliverOrderPayload;

      await this.jobQueue.enqueue(qr, {
        kind: JOB_KIND.DELIVER_ORDER,
        dedupeKey: buildDeliverOrderDedupeKey(updated.ext_id),
        payload,
        runAt: new Date(),
        traceId: null,
      });

      return { generation: updated.delivery_generation };
    });

    this.logger.event(LOG_EVENT.ADMIN_REDELIVER, {
      order_id: input.orderId,
      generation: result.generation,
      reason: input.reason ?? null,
    });

    return { enqueued: true, generation: result.generation };
  }

  private generatePoolCodes(count: number): string[] {
    return Array.from({ length: count }, () => randomUUID());
  }
}
