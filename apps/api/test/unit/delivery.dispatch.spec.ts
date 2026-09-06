import type { QueryRunner } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import { DomainError } from '../../src/common/errors/domain.error';
import { ERROR_CODE } from '../../src/common/errors/errors.constants';
import type { UnitOfWorkService } from '../../src/common/db/unit-of-work.service';
import { DeliveryService } from '../../src/delivery/delivery.service';
import {
  buildOrderNotFoundMessage,
  buildUnknownFulfillmentModeMessage,
} from '../../src/delivery/delivery.util';
import type { DeliveryRepository } from '../../src/delivery/delivery.repository';
import type { IDeliveryResult, IFulfilmentService } from '../../src/delivery/delivery.interfaces';
import type { FulfillmentMode } from '../../src/catalog/catalog.type';

interface IFulfilmentMock {
  service: IFulfilmentService;
  fulfil: Mock<IFulfilmentService['fulfil']>;
}

const ORDER_ID = 42;

const GENERATION = 1;

function buildUnitOfWork(): UnitOfWorkService {
  const withTransaction = vi.fn((work: (qr: QueryRunner) => Promise<unknown>) =>
    work({} as QueryRunner),
  );

  return { withTransaction } as unknown as UnitOfWorkService;
}

function buildDeliveryRepository(mode: FulfillmentMode | null): DeliveryRepository {
  const findFulfillmentMode = vi.fn().mockResolvedValue(mode);

  return { findFulfillmentMode } as unknown as DeliveryRepository;
}

function buildFulfilmentService(mode: FulfillmentMode, result: IDeliveryResult): IFulfilmentMock {
  const fulfil = vi.fn<IFulfilmentService['fulfil']>().mockResolvedValue(result);

  return { service: { mode, fulfil }, fulfil };
}

describe('DeliveryService.deliver mode dispatch', () => {
  it('throws ORDER_NOT_FOUND when the order does not exist', async () => {
    const service = new DeliveryService(buildUnitOfWork(), buildDeliveryRepository(null), []);

    await expect(
      service.deliver({ orderId: ORDER_ID, generation: GENERATION }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.ORDER_NOT_FOUND,
      message: buildOrderNotFoundMessage(ORDER_ID),
    });
  });

  it('delegates to the matching fulfilment service for supplier mode', async () => {
    const result: IDeliveryResult = { outcome: 'delivered', code: 'SUP-XYZ' };
    const supplier = buildFulfilmentService('supplier', result);
    const service = new DeliveryService(buildUnitOfWork(), buildDeliveryRepository('supplier'), [
      supplier.service,
    ]);

    const outcome = await service.deliver({ orderId: ORDER_ID, generation: GENERATION });

    expect(outcome).toEqual(result);
    expect(supplier.fulfil).toHaveBeenCalledWith({ orderId: ORDER_ID, generation: GENERATION });
  });

  it('delegates to the matching fulfilment service for pool mode', async () => {
    const result: IDeliveryResult = { outcome: 'delivered', code: 'KEY-XYZ' };
    const pool = buildFulfilmentService('pool', result);
    const service = new DeliveryService(buildUnitOfWork(), buildDeliveryRepository('pool'), [
      pool.service,
    ]);

    const outcome = await service.deliver({ orderId: ORDER_ID, generation: GENERATION });

    expect(outcome).toEqual(result);
    expect(pool.fulfil).toHaveBeenCalledWith({ orderId: ORDER_ID, generation: GENERATION });
  });

  it('throws for a mode without a registered fulfilment service', async () => {
    const service = new DeliveryService(buildUnitOfWork(), buildDeliveryRepository('pool'), []);

    await expect(
      service.deliver({ orderId: ORDER_ID, generation: GENERATION }),
    ).rejects.toMatchObject({
      code: ERROR_CODE.INTERNAL_ERROR,
      message: buildUnknownFulfillmentModeMessage('pool'),
    });
  });

  it('propagates a DomainError instance, not a plain error', async () => {
    const service = new DeliveryService(buildUnitOfWork(), buildDeliveryRepository(null), []);

    await expect(
      service.deliver({ orderId: ORDER_ID, generation: GENERATION }),
    ).rejects.toBeInstanceOf(DomainError);
  });
});
