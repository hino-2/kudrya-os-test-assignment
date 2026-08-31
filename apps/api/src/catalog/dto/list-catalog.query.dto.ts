import { Type } from 'class-transformer';
import { IsBooleanString, IsIn, IsInt, IsOptional, Length, Matches, Max, Min } from 'class-validator';

import {
  CATALOG_LIMIT_HARD_MAX,
  CATALOG_LIMIT_MIN,
  PRODUCT_TYPE_VALUES,
  SKU_PREFIX_MAX_LENGTH,
  SKU_PREFIX_REGEX,
} from '../catalog.constants';
import type { ProductType } from '../catalog.type';

export class ListCatalogQueryDto {
  @IsOptional()
  @IsIn(PRODUCT_TYPE_VALUES)
  type?: ProductType;

  @IsOptional()
  @IsBooleanString()
  in_stock?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CATALOG_LIMIT_MIN)
  @Max(CATALOG_LIMIT_HARD_MAX)
  limit?: number;

  @IsOptional()
  @Length(1, SKU_PREFIX_MAX_LENGTH)
  @Matches(SKU_PREFIX_REGEX)
  q?: string;
}
