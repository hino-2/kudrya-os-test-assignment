import type { ISupplierRestockOutcome } from '../suppliers/suppliers.interfaces';

export interface IRestockInput {
  sku: string;
  codes?: string[];
  count?: number;
}

export interface IRestockResult {
  added: number;
  availableCount: number;
  // null для pool-режима (поставщик не участвует); для supplier-режима — исход по каждому
  // поставщику, потому что счётчик уже увеличен независимо от того, приняли ли пополнение
  supplierRestock: ISupplierRestockOutcome[] | null;
}

export interface IRedeliverInput {
  orderId: string;
  reason?: string;
}

export interface IRedeliverResult {
  enqueued: boolean;
  generation: number;
}
