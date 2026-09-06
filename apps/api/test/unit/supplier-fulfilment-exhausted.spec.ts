import { describe, expect, it, vi } from 'vitest';
import type { QueryRunner } from 'typeorm';

import { AppConfigService } from '../../src/common/config/app-config.service';
import { UnitOfWorkService } from '../../src/common/db/unit-of-work.service';
import { AppLoggerService } from '../../src/common/logging/app-logger.service';
import { CorrelationStore } from '../../src/common/logging/correlation.store';
import { JsonLogger } from '../../src/common/logging/json-logger';
import { DeliveryAttemptRepository } from '../../src/delivery/delivery-attempt.repository';
import { DeliveryRepository } from '../../src/delivery/delivery.repository';
import {
  ATTEMPT_STATE,
  DELIVERY_OUTCOME,
  DELIVERY_OUT_OF_STOCK_REASON,
} from '../../src/delivery/delivery.constants';
import type { IDeliveryAttemptRow, ILockedOrderRow } from '../../src/delivery/delivery.interfaces';
import { SupplierFulfilmentService } from '../../src/delivery/supplier-fulfilment.service';
import { LedgerService } from '../../src/ledger/ledger.service';
import { ORDER_STATUS } from '../../src/orders/orders.constants';
import { OrdersRepository } from '../../src/orders/orders.repository';
import { SupplierClient } from '../../src/suppliers/supplier.client';
import { SUPPLIER_CODE, SUPPLIER_ERROR_KIND } from '../../src/suppliers/suppliers.constants';
import type { SupplierCode, SupplierErrorKind } from '../../src/suppliers/suppliers.type';

const ORDER_ID = 1;

const LOCKED_ORDER: ILockedOrderRow = {
  id: ORDER_ID,
  ext_id: 'ord_00100',
  status: ORDER_STATUS.DELIVERING,
  generation: 0,
  product_id: 1,
  sku: 'STEAM-TOPUP-500',
  amount_minor: 50000,
  currency: 'RUB',
  fulfillment_mode: 'supplier',
};

// тестовый дубль строки попытки: заполнены только поля, на которые смотрят pickSupplier
// и resolveExhaustedOutcome
function buildFailedAttempt(
  id: number,
  supplierCode: SupplierCode,
  attemptNo: number,
  errorKind: SupplierErrorKind,
): IDeliveryAttemptRow {
  return {
    id,
    order_id: ORDER_ID,
    supplier_code: supplierCode,
    attempt_no: attemptNo,
    request_id: `req_${supplierCode}${attemptNo}`,
    sku: 'STEAM-TOPUP-500',
    delivery_generation: 0,
    state: ATTEMPT_STATE.FAILED,
    http_status: 409,
    response_code: null,
    error_kind: errorKind,
    error_reason: null,
    resolve_attempts: 0,
    next_resolve_at: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    created_at: new Date(),
    updated_at: new Date(),
  };
}

function buildLogger(): AppLoggerService {
  return new AppLoggerService(
    new JsonLogger({ level: 'error', format: 'json', includeStack: false, sink: () => {} }),
    new CorrelationStore(),
    'SupplierFulfilmentService',
  );
}

// jobBudgetMs = 0 ставит fulfil() ровно в ту точку, где принудительный отказ вообще достижим:
// проверка бюджета стоит в начале цикла, поэтому истёкший бюджет уводит последнюю попытку
// джобы в forceDeliveryFailedIfExhausted до единого HTTP-вызова — ни поставщики, ни очередь
// в этом сценарии не участвуют
function buildConfig(): AppConfigService {
  return {
    supplier: {
      jobBudgetMs: 0,
      maxAttemptsPerSupplier: 2,
      unknownMaxResolveAttempts: 5,
      retryBaseMs: 100,
      retryMaxMs: 200,
    },
  } as unknown as AppConfigService;
}

function buildService(
  attempts: IDeliveryAttemptRow[],
  transition: OrdersRepository['transition'],
): SupplierFulfilmentService {
  const unitOfWork = {
    withTransaction: <T>(fn: (qr: QueryRunner) => Promise<T>) => fn({} as QueryRunner),
  } as unknown as UnitOfWorkService;
  const deliveryRepository = {
    lockOrderForDelivery: () => Promise.resolve(LOCKED_ORDER),
  } as unknown as DeliveryRepository;
  const attemptRepository = {
    // цепочка исчерпана и открытых попыток нет — предикат штатного пути (finalizeExhausted)
    findOpenAttempt: () => Promise.resolve(null),
    findAttemptsByOrder: () => Promise.resolve(attempts),
  } as unknown as DeliveryAttemptRepository;
  const ordersRepository = { transition } as unknown as OrdersRepository;

  return new SupplierFulfilmentService(
    unitOfWork,
    deliveryRepository,
    attemptRepository,
    {} as SupplierClient,
    buildConfig(),
    ordersRepository,
    {} as LedgerService,
    buildLogger(),
  );
}

describe('SupplierFulfilmentService forced terminal outcome on the job last attempt', () => {
  // регрессия: принудительный путь считал исход сам и всегда писал delivery_failed, тогда как
  // штатный (finalizeExhausted) на той же истории попыток дал бы out_of_stock. Разница не
  // косметическая: out_of_stock переигрывает проход 3 свипера только после restock, а
  // delivery_failed — проход 4 по таймеру, то есть заказ жёг бы поколения на поставщиках
  it('reports out_of_stock when both suppliers refused for out_of_stock', async () => {
    const transition = vi.fn(() => Promise.resolve({}));
    const service = buildService(
      [
        buildFailedAttempt(1, SUPPLIER_CODE.A, 1, SUPPLIER_ERROR_KIND.OUT_OF_STOCK),
        buildFailedAttempt(2, SUPPLIER_CODE.B, 1, SUPPLIER_ERROR_KIND.OUT_OF_STOCK),
      ],
      transition as unknown as OrdersRepository['transition'],
    );
    const result = await service.fulfil({ orderId: ORDER_ID, generation: 0, attempts: 1, maxAttempts: 1 });

    expect(result).toEqual({ outcome: DELIVERY_OUTCOME.OUT_OF_STOCK, code: null });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith({}, ORDER_ID, ORDER_STATUS.DELIVERING, ORDER_STATUS.OUT_OF_STOCK, {
      failureReason: DELIVERY_OUT_OF_STOCK_REASON,
    });
  });

  // note 9: failure_reason принудительного пути — та же сводка по поставщикам, что и у штатного
  // ("A=…, B=…"), приписка про бюджет джобы идёт после неё, а не вместо
  it('reports delivery_failed with the per-supplier summary when a refusal was not out_of_stock', async () => {
    const transition = vi.fn(() => Promise.resolve({}));
    const service = buildService(
      [
        buildFailedAttempt(1, SUPPLIER_CODE.A, 1, SUPPLIER_ERROR_KIND.HTTP_5XX),
        buildFailedAttempt(2, SUPPLIER_CODE.A, 2, SUPPLIER_ERROR_KIND.HTTP_5XX),
        buildFailedAttempt(3, SUPPLIER_CODE.B, 1, SUPPLIER_ERROR_KIND.OUT_OF_STOCK),
      ],
      transition as unknown as OrdersRepository['transition'],
    );
    const result = await service.fulfil({ orderId: ORDER_ID, generation: 0, attempts: 1, maxAttempts: 1 });

    expect(result).toEqual({ outcome: DELIVERY_OUTCOME.DELIVERY_FAILED, code: null });
    expect(transition).toHaveBeenCalledTimes(1);
    expect(transition).toHaveBeenCalledWith({}, ORDER_ID, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERY_FAILED, {
      failureReason: expect.stringMatching(
        /^A=http_5xx, B=out_of_stock \(.*Бюджет времени на выдачу через поставщика.*\)$/,
      ),
    });
  });
});
