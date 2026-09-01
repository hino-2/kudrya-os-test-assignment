import type { OrderStatus } from '../../orders/orders.type';
import type { WebhookResult } from '../payments.type';

export class PaymentWebhookResponseDto {
  accepted!: boolean;
  result!: WebhookResult;
  order_status!: OrderStatus | null;
  event_id!: string;
}
