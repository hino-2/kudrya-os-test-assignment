import type { SupplierCode } from '../../suppliers/suppliers.type';

// исход пополнения у одного поставщика: счётчик sku_stock увеличивается до сетевого вызова,
// поэтому ответ обязан показывать, приняли ли пополнение на самом деле
export class RestockSupplierOutcomeDto {
  supplier_code!: SupplierCode;
  ok!: boolean;
  http_status!: number | null;
  error_reason!: string | null;
}

export class RestockResponseDto {
  added!: number;
  available_count!: number;
  // null для pool-режима: поставщик в пополнении не участвует
  supplier_restock!: RestockSupplierOutcomeDto[] | null;
}
