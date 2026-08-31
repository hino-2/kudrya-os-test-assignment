import type { SeedProductType } from './seed-catalog.type';

export interface IProductSeed {
  sku: string;
  name: string;
  type: SeedProductType;
  price: number;
  currency: string;
  image: string | null;
}

export interface IProductsFile {
  products: IProductSeed[];
}

export interface IKeysFile {
  keys: string[];
}

export interface ISeedVerifyRow {
  sku: string;
  type: string;
  fulfillment_mode: string;
  price_minor: string;
  in_stock: boolean;
  available_count: number;
  key_count: number;
}

export interface ISeedSummary {
  products: number;
  keys: number;
  pool: number;
  supplier: number;
}
