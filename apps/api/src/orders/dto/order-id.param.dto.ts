import { Matches } from 'class-validator';

import { EXT_ID_REGEX } from '../orders.constants';

export class OrderIdParamDto {
  @Matches(EXT_ID_REGEX)
  orderId!: string;
}
