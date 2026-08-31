import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import type { ProductType } from './catalog.type';

export interface ICatalogCursorPosition {
  sku: string;
  id: number;
}

export interface ICatalogFilter {
  type: ProductType | null;
  inStockOnly: boolean;
  skuPrefix: string | null;
  after: ICatalogCursorPosition | null;
  limit: number;
}

export interface ICatalogRow {
  id: number;
  sku: string;
  name: string;
  type: ProductType;
  price_minor: MinorAmount;
  currency: CurrencyCode;
  image_url: string | null;
  available_count: number;
}

export interface ICatalogPage {
  rows: ICatalogRow[];
  hasMore: boolean;
}
