import type { CurrencyCode, MajorAmount, MinorAmount } from '../../common/money/money.type';
import type { OrderStatus } from '../orders.type';

export class CreateOrderResponseDto {
  order_id!: string;
  status!: OrderStatus;
  sku!: string;
  quantity!: number;
  amount_minor!: MinorAmount;
  amount!: MajorAmount;
  currency!: CurrencyCode;
  created_at!: string;
}
