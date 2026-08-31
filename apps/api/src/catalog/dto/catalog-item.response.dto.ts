import type { CurrencyCode, MajorAmount, MinorAmount } from '../../common/money/money.type';
import type { ProductType } from '../catalog.type';

export class CatalogItemResponseDto {
  sku!: string;
  name!: string;
  type!: ProductType;
  amount_minor!: MinorAmount;
  amount!: MajorAmount;
  currency!: CurrencyCode;
  image!: string | null;
  available_count!: number;
  in_stock!: boolean;
}
