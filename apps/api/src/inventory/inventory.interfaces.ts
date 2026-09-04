import type { FulfillmentMode } from '../catalog/catalog.type';

export interface IStockKeyRow {
  id: number;
  code: string;
}

export interface ILockedProductStockRow {
  id: number;
  sku: string;
  fulfillment_mode: FulfillmentMode;
  available_count: number;
}
