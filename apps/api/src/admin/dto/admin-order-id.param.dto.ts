import { Matches } from 'class-validator';

import { EXT_ID_REGEX } from '../../orders/orders.constants';

export class AdminOrderIdParamDto {
  @Matches(EXT_ID_REGEX)
  orderId!: string;
}
