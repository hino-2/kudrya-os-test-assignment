import { Injectable } from '@nestjs/common';

import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { JOB_KIND } from '../jobs/jobs.constants';
import type { IJobHandler, IJobRow } from '../jobs/jobs.interfaces';
import { INVALID_DELIVER_ORDER_PAYLOAD_MESSAGE } from './delivery.constants';
import { DeliveryService } from './delivery.service';
import { isDeliverOrderPayload } from './delivery.util';

@Injectable()
export class DeliverOrderHandler implements IJobHandler {
  readonly kind = JOB_KIND.DELIVER_ORDER;

  constructor(private readonly deliveryService: DeliveryService) {}

  // Легитимные бизнес-исходы (out_of_stock, already_delivered, skipped) не бросают —
  // воркер трактует любое исключение как fail задачи с retry/dead. Логирование исходов
  // делает PoolFulfilmentService/JobWorkerService, здесь дублировать не нужно.
  async handle(job: IJobRow): Promise<void> {
    if (!isDeliverOrderPayload(job.payload)) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, INVALID_DELIVER_ORDER_PAYLOAD_MESSAGE);
    }

    await this.deliveryService.deliver({
      orderId: job.payload.orderId,
      generation: job.payload.generation,
    });
  }
}
