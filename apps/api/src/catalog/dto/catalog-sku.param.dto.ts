import { Matches } from 'class-validator';

import { SKU_PARAM_REGEX } from '../catalog.constants';

export class CatalogSkuParamDto {
  @Matches(SKU_PARAM_REGEX)
  sku!: string;
}
