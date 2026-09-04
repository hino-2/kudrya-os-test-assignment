import { Matches } from 'class-validator';

import { SKU_PARAM_REGEX } from '../../catalog/catalog.constants';

export class RestockSkuParamDto {
  @Matches(SKU_PARAM_REGEX)
  sku!: string;
}
