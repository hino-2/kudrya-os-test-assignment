import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import {
  ORDER_EXT_ID_TAKEN_MESSAGE,
  ORDER_PAYMENT_EVENTS_LIMIT,
  ORDER_REPLAY_LOST_MESSAGE,
} from './orders.constants';
import type { ICreateOrderOutcome } from './orders.interfaces';
import { toCreateOrderResponse, toOrderResponse } from './orders.mapper';
import { OrdersRepository } from './orders.repository';
import { buildOrderDraft } from './orders.util';
import type { CreateOrderRequestDto } from './dto/create-order.request.dto';
import type { OrderResponseDto } from './dto/order.response.dto';

@Injectable()
export class OrdersService {
  constructor(
    private readonly repository: OrdersRepository,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('OrdersService');
  }

  async create(dto: CreateOrderRequestDto): Promise<ICreateOrderOutcome> {
    const outcome = await this.unitOfWork.withTransaction((qr) =>
      this.createInTransaction(qr, dto),
    );

    this.logger.event(LOG_EVENT.ORDER_CREATED, {
      order_id: outcome.order.order_id,
      sku: outcome.order.sku,
      amount_minor: outcome.order.amount_minor,
      replay: !outcome.created,
    });

    return outcome;
  }

  async getByExtId(extId: string): Promise<OrderResponseDto> {
    // Заказ читается первым: статус delivered и строка issued_deliveries пишутся одной
    // транзакцией, поэтому обратный порядок мог бы показать выданный заказ без выдачи.
    const order = await this.repository.findByExtId(extId);

    if (order === null) {
      throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND, undefined, { order_id: extId });
    }

    const [delivery, paymentEvents, deliveryAttempts] = await Promise.all([
      this.repository.findDelivery(order.id),
      this.repository.findRecentPaymentEvents(order.id, ORDER_PAYMENT_EVENTS_LIMIT),
      this.repository.findDeliveryAttempts(order.id),
    ]);

    return toOrderResponse({ order, delivery, paymentEvents, deliveryAttempts });
  }

  private async createInTransaction(
    qr: QueryRunner,
    dto: CreateOrderRequestDto,
  ): Promise<ICreateOrderOutcome> {
    const clientOrderId = dto.client_order_id ?? null;

    if (clientOrderId !== null) {
      // Повтор по client_order_id отвечает сохранённым заказом раньше проверок товара:
      // иначе снятый с продажи sku ломал бы ответ на давно принятый заказ.
      const replayed = await this.repository.findByExtId(clientOrderId, qr);

      if (replayed !== null) {
        return { created: false, order: toCreateOrderResponse(replayed) };
      }
    }

    const product = await this.repository.findProductBySku(qr, dto.sku);

    if (product === null) {
      throw new DomainError(ERROR_CODE.PRODUCT_NOT_FOUND, undefined, { sku: dto.sku });
    }

    if (!product.is_active) {
      throw new DomainError(ERROR_CODE.PRODUCT_INACTIVE, undefined, { sku: dto.sku });
    }

    const extId = clientOrderId ?? (await this.repository.nextExtId(qr));
    const inserted = await this.repository.insert(qr, buildOrderDraft(product, dto, extId));

    if (inserted !== null) {
      return { created: true, order: toCreateOrderResponse(inserted) };
    }

    if (clientOrderId === null) {
      // Выданный последовательностью ext_id уже занят: чужой заказ отдавать нельзя.
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, ORDER_EXT_ID_TAKEN_MESSAGE, {
        order_id: extId,
      });
    }

    const existing = await this.repository.findByExtId(extId, qr);

    if (existing === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, ORDER_REPLAY_LOST_MESSAGE, {
        order_id: extId,
      });
    }

    return { created: false, order: toCreateOrderResponse(existing) };
  }
}
