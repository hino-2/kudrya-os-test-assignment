import type { FulfillmentMode } from '../catalog/catalog.type';

export interface IStockKeyRow {
  id: number;
  code: string;
}

// RETURNING у CAS-переходов sku_stock: каждый оператор возвращает только тронутый счётчик,
// поэтому поля опциональны — сам факт наличия строки и есть результат перехода
export interface ISkuStockCountersRow {
  available_count?: number;
  reserved_count?: number;
}

export interface ILockedProductStockRow {
  id: number;
  sku: string;
  fulfillment_mode: FulfillmentMode;
  available_count: number;
}
