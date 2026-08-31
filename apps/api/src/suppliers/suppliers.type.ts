import type { SUPPLIER_CODE } from './suppliers.constants';

export type SupplierCode = (typeof SUPPLIER_CODE)[keyof typeof SUPPLIER_CODE];
