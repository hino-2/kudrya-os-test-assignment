import type { SUPPLIER_CODE, SUPPLIER_ERROR_KIND, SUPPLIER_OUTCOME } from './suppliers.constants';
import type { ISupplierIssueResult } from './suppliers.interfaces';

export type SupplierCode = (typeof SUPPLIER_CODE)[keyof typeof SUPPLIER_CODE];

export type SupplierOutcomeKind = (typeof SUPPLIER_OUTCOME)[keyof typeof SUPPLIER_OUTCOME];

export type SupplierErrorKind = (typeof SUPPLIER_ERROR_KIND)[keyof typeof SUPPLIER_ERROR_KIND];

export type IssueOutcomeShape = Omit<ISupplierIssueResult, 'durationMs'>;
