import type { PaymentWebhookResponseDto } from './dto/payment-webhook.response.dto';
import type { IWebhookOutcome } from './payments.interfaces';

export function toWebhookResponse(outcome: IWebhookOutcome): PaymentWebhookResponseDto {
  return {
    accepted: true,
    result: outcome.result,
    order_status: outcome.orderStatus,
    event_id: outcome.eventId,
  };
}
