import type { SupplierCode, SupplierErrorKind, SupplierOutcomeKind } from './suppliers.type';

export interface ISupplierIssueRequestBody {
  request_id: string;
  sku: string;
  order_id: string;
}

export interface ISupplierIssueSuccessBody {
  status?: string;
  request_id?: string;
  code?: string;
}

export interface ISupplierIssueErrorBody {
  status?: string;
  reason?: string;
}

export interface ISupplierRestockRequestBody {
  count: number;
}

export interface ISupplierIssueInput {
  supplierCode: SupplierCode;
  requestId: string;
  sku: string;
  orderExtId: string;
}

export interface ISupplierIssueResult {
  kind: SupplierOutcomeKind;
  code: string | null;
  httpStatus: number | null;
  errorKind: SupplierErrorKind | null;
  errorReason: string | null;
  durationMs: number;
}

export interface IRequestIdParts {
  extId: string;
  generation: number;
  supplierCode: SupplierCode;
  attemptNo: number;
}

export interface INetworkErrorClassification {
  kind: SupplierOutcomeKind;
  errorKind: SupplierErrorKind;
}

export interface IHttpStatusClassification {
  kind: SupplierOutcomeKind;
  errorKind: SupplierErrorKind;
  reason: string | null;
}
