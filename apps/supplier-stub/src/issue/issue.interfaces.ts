import type { SupplierId } from '../config/stub-config.type';

export interface IIssueResult {
  status: 'ok';
  request_id: string;
  sku: string;
  order_id: string;
  code: string;
  issued_at: string;
  replayed: boolean;
}

export interface IIssueLookupResult {
  status: 'ok';
  request_id: string;
  code: string;
}

export interface IInventoryView {
  supplierId: SupplierId;
  total: number;
  consumed: number;
  remaining: number;
}

export interface IIssueErrorBody {
  status: 'error';
  reason: string;
}
