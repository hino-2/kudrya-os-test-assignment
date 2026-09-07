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
import {
  RESTOCK_BODY_INVALID_MESSAGE,
  RESTOCK_KIND,
  RESTOCK_SUPPLIER_CODES_UNSUPPORTED_MESSAGE,
} from './admin.constants';
import type {
  IRedeliverInput,
  IRedeliverResult,
  IRestockInput,
  IRestockResult,
} from './admin.interfaces';
import type { RestockPlan } from './admin.type';

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
    const plan = this.toRestockPlan(input);

    let supplierRestockCount: number | null = null;

    const result = await this.unitOfWork.withTransaction(async (qr) => {
      const product = await this.inventory.lockProductStockBySku(qr, input.sku);

      if (product === null) {
        throw new DomainError(ERROR_CODE.PRODUCT_NOT_FOUND);
      }

      if (product.fulfillment_mode === FULFILLMENT_MODE.SUPPLIER) {
        if (plan.kind === RESTOCK_KIND.CODES) {
          throw new DomainError(
            ERROR_CODE.VALIDATION_FAILED,
            RESTOCK_SUPPLIER_CODES_UNSUPPORTED_MESSAGE,
          );
        }

        const availableCount = await this.inventory.bumpAvailableCount(qr, product.id, plan.count);

        await this.inventory.syncProductInStock(qr, product.id);
        supplierRestockCount = plan.count;

        return { added: plan.count, availableCount };
      }

      const codes =
        plan.kind === RESTOCK_KIND.CODES ? plan.codes : this.generatePoolCodes(plan.count);
      const insertedCount = await this.inventory.insertRestockKeys(
        qr,
        product.id,
        codes,
        RESTOCK_BATCH,
      );
      const availableCount = await this.inventory.bumpAvailableCount(qr, product.id, insertedCount);

      await this.inventory.syncProductInStock(qr, product.id);

      return { added: insertedCount, availableCount };
    });

    // вызов поставщика — сайд-эффект, идёт после коммита, чтобы не держать TX открытой на время сети
    const supplierRestock =
      supplierRestockCount === null
        ? null
        : await this.supplierClient.restock(supplierRestockCount);

    const failedRestockCount = supplierRestock?.filter((outcome) => !outcome.ok).length ?? 0;

    this.logger.event(LOG_EVENT.ADMIN_RESTOCK, {
      sku: input.sku,
      added: result.added,
      available_count: result.availableCount,
      supplier_restock_failed: failedRestockCount,
    });

    return { added: result.added, availableCount: result.availableCount, supplierRestock };
  }

  async redeliver(input: IRedeliverInput): Promise<IRedeliverResult> {
    const result = await this.unitOfWork.withTransaction(async (qr) => {
      const order = await this.orders.lockForUpdate(qr, input.orderExtId);

      if (order === null) {
        throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND);
      }

      // qr обязателен: гард «уже выдано» должен читаться той же транзакцией, что держит
      // FOR UPDATE по строке заказа, а не вторым соединением пула
      const delivery = await this.orders.findDelivery(order.id, qr);

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

      // tryTransition, а не transition: 0 строк здесь означает, что заказ уже увели из
      // восстановимого статуса, — это домен, а не внутренняя ошибка
      const updated = await this.orders.tryTransition(qr, order.id, order.status, rule.to, {
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

      // null означает, что ON CONFLICT DO NOTHING отбросил вставку: живая джоба по этому
      // заказу уже есть, но она несёт прежнее поколение и скипнется на проверке. Поколение
      // при этом уже забампилось, поэтому отвечаем 202 с enqueued=false, а не молчаливым true
      const jobId = await this.jobQueue.enqueue(qr, {
        kind: JOB_KIND.DELIVER_ORDER,
        dedupeKey: buildDeliverOrderDedupeKey(updated.ext_id),
        payload,
        runAt: new Date(),
        traceId: null,
      });

      return { generation: updated.delivery_generation, enqueued: jobId !== null };
    });

    this.logger.event(LOG_EVENT.ADMIN_REDELIVER, {
      order_id: input.orderExtId,
      generation: result.generation,
      enqueued: result.enqueued,
      reason: input.reason ?? null,
    });

    return { enqueued: result.enqueued, generation: result.generation };
  }

  private generatePoolCodes(count: number): string[] {
    return Array.from({ length: count }, () => randomUUID());
  }

  private toRestockPlan(input: IRestockInput): RestockPlan {
    if (input.codes !== undefined && input.count === undefined) {
      return { kind: RESTOCK_KIND.CODES, codes: input.codes };
    }

    if (input.count !== undefined && input.codes === undefined) {
      return { kind: RESTOCK_KIND.COUNT, count: input.count };
    }

    throw new DomainError(ERROR_CODE.VALIDATION_FAILED, RESTOCK_BODY_INVALID_MESSAGE);
  }
}
