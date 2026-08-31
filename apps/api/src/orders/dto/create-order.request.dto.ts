import { Equals, IsEmail, IsInt, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

import { SKU_PARAM_REGEX } from '../../catalog/catalog.constants';
import {
  BUYER_EMAIL_MAX_LENGTH,
  CLIENT_EXT_ID_REGEX,
  ORDER_DEFAULT_QUANTITY,
} from '../orders.constants';

export class CreateOrderRequestDto {
  @IsString()
  @Matches(SKU_PARAM_REGEX)
  sku!: string;

  @IsOptional()
  @Matches(CLIENT_EXT_ID_REGEX)
  client_order_id?: string;

  @IsOptional()
  @IsInt()
  @Equals(ORDER_DEFAULT_QUANTITY)
  quantity?: number;

  @IsOptional()
  @IsEmail()
  @MaxLength(BUYER_EMAIL_MAX_LENGTH)
  buyer_email?: string;
}
