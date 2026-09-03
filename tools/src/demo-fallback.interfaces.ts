import type { FailMode } from './demo-fallback.type';

export interface IDemoFallbackCliOptions {
  order: string | undefined;
  sku: string;
  amount: number | undefined;
  currency: string;
  failMode: FailMode;
  apiBaseUrl: string;
  supplierABaseUrl: string;
  supplierBBaseUrl: string;
  timeoutMs: number;
  waitMs: number;
  useStubControl: boolean;
  resetStubs: boolean;
}

export interface IDemoTarget {
  extId: string;
  sku: string;
  amountMajor: number;
  currency: string;
}

export interface IWebhookPayload {
  event_id: string;
  order_id: string;
  status: string;
  amount: number;
  currency: string;
  created_at: string;
}

export interface IWebhookResultBody {
  accepted: boolean;
  result: string;
  order_status: string;
  event_id: string;
}

export interface ICatalogItemResponse {
  sku: string;
  type: string;
}

export interface IOrderCreateResponse {
  order_id: string;
  status: string;
  sku: string;
  amount: number;
  currency: string;
}

export interface IOrderDeliveryBlock {
  code: string;
  source: string;
  supplier: string | null;
  delivered_at: string;
}

export interface IOrderDeliveryAttemptBlock {
  supplier: string;
  attempt_no: number;
  request_id: string;
  state: string;
  error_kind: string | null;
  duration_ms: number | null;
}

export interface IOrderDetailResponse {
  order_id: string;
  status: string;
  terminal: boolean;
  sku: string;
  amount: number;
  currency: string;
  failure_reason: string | null;
  delivery: IOrderDeliveryBlock | null;
  delivery_attempts: IOrderDeliveryAttemptBlock[];
}

export interface IStubScenarioView {
  mode: string;
  remaining: number | null;
}

export interface IStubControlState {
  scenario: IStubScenarioView;
  issuedCount: number;
}

export interface IStubSnapshot {
  available: boolean;
  issuedCount: number;
}

export interface IStubSnapshotPair {
  a: IStubSnapshot;
  b: IStubSnapshot;
}

export interface IPollOutcome {
  detail: IOrderDetailResponse | null;
  settled: boolean;
  waitedMs: number;
}
