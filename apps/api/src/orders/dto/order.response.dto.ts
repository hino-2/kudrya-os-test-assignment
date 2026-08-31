import type { CurrencyCode, MajorAmount, MinorAmount } from '../../common/money/money.type';
import type { OrderStatus } from '../orders.type';
import type { OrderDeliveryResponseDto } from './order-delivery.response.dto';
import type { OrderDeliveryAttemptResponseDto } from './order-delivery-attempt.response.dto';
import type { OrderPaymentEventResponseDto } from './order-payment-event.response.dto';

export class OrderResponseDto {
  order_id!: string;
  status!: OrderStatus;
  recoverable!: boolean;
  terminal!: boolean;
  sku!: string;
  quantity!: number;
  amount_minor!: MinorAmount;
  amount!: MajorAmount;
  currency!: CurrencyCode;
  created_at!: string;
  paid_at!: string | null;
  delivered_at!: string | null;
  failure_reason!: string | null;
  delivery!: OrderDeliveryResponseDto | null;
  payment_events!: OrderPaymentEventResponseDto[];
  delivery_attempts!: OrderDeliveryAttemptResponseDto[];
}
