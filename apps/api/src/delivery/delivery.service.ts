import { Inject, Injectable } from '@nestjs/common';

import { FULFILLMENT_MODE } from '../catalog/catalog.constants';
import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { DELIVERY_FULFILMENT_SERVICES, SUPPLIER_MODE_NOT_IMPLEMENTED_MESSAGE } from './delivery.constants';
import { DeliveryRepository } from './delivery.repository';
import { buildOrderNotFoundMessage, buildUnknownFulfillmentModeMessage } from './delivery.util';
import type { IDeliveryResult, IFulfilInput, IFulfilmentService } from './delivery.interfaces';

@Injectable()
export class DeliveryService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly deliveryRepository: DeliveryRepository,
    @Inject(DELIVERY_FULFILMENT_SERVICES) private readonly fulfilmentServices: readonly IFulfilmentService[],
  ) {}

  async deliver(input: IFulfilInput): Promise<IDeliveryResult> {
    const mode = await this.unitOfWork.withTransaction((qr) => this.deliveryRepository.findFulfillmentMode(qr, input.orderId));

    if (mode === null) {
      throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND, buildOrderNotFoundMessage(input.orderId));
    }

    if (mode === FULFILLMENT_MODE.SUPPLIER) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, SUPPLIER_MODE_NOT_IMPLEMENTED_MESSAGE);
    }

    const service = this.fulfilmentServices.find((candidate) => candidate.mode === mode);

    if (service === undefined) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, buildUnknownFulfillmentModeMessage(mode));
    }

    return service.fulfil(input);
  }
}
