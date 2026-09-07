import type { ISupplierRestockOutcome } from '../suppliers/suppliers.interfaces';
import type { RESTOCK_KIND } from './admin.constants';

export interface IRestockInput {
  sku: string;
  codes?: string[];
  count?: number;
}

export interface IRestockCodesPlan {
  kind: typeof RESTOCK_KIND.CODES;
  codes: string[];
}

export interface IRestockCountPlan {
  kind: typeof RESTOCK_KIND.COUNT;
  count: number;
}

export interface IRestockResult {
  added: number;
  availableCount: number;
  // null для pool-режима (поставщик не участвует); для supplier-режима — исход по каждому
  // поставщику, потому что счётчик уже увеличен независимо от того, приняли ли пополнение
  supplierRestock: ISupplierRestockOutcome[] | null;
}

export interface IRedeliverInput {
  orderExtId: string;
  reason?: string;
}

export interface IRedeliverResult {
  enqueued: boolean;
  generation: number;
}
