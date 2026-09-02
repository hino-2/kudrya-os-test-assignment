import type { SupplierId } from '../config/stub-config.type';

export interface IIssueResult {
  requestId: string;
  sku: string;
  orderId: string;
  code: string;
  issuedAt: string;
  replayed: boolean;
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
