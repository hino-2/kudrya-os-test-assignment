import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';

import { AppLoggerService } from '../common/logging/app-logger.service';
import { PAYMENTS_ROUTE, PAYMENT_WEBHOOK_PATH, PAYMENT_WEBHOOK_STATUS } from './payments.constants';
import { toWebhookResponse } from './payments.mapper';
import { PaymentWebhookService } from './payment-webhook.service';
import { toRawPayload } from './payments.util';
import { PaymentWebhookRequestDto } from './dto/payment-webhook.request.dto';
import type { PaymentWebhookResponseDto } from './dto/payment-webhook.response.dto';

@Controller(PAYMENTS_ROUTE)
export class PaymentWebhookController {
  constructor(
    private readonly service: PaymentWebhookService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('PaymentWebhookController');
  }

  @Post(PAYMENT_WEBHOOK_PATH)
  @HttpCode(PAYMENT_WEBHOOK_STATUS)
  handle(@Body() dto: PaymentWebhookRequestDto, @Req() request: Request): Promise<PaymentWebhookResponseDto> {
    return this.logger.withCorrelation({ order_id: dto.order_id, event_id: dto.event_id }, async () =>
      toWebhookResponse(await this.service.handle(dto, toRawPayload(request.body, dto))),
    );
  }
}
