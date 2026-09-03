export interface IRaceCliOptions {
  order: string | undefined;
  sku: string | undefined;
  count: number;
  amount: number | undefined;
  currency: string;
  apiBaseUrl: string;
  supplierABaseUrl: string;
  timeoutMs: number;
  useDb: boolean;
  useStubControl: boolean;
  resetStubs: boolean;
}

export interface IRacePayload {
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

export interface IOrderCreateResponse {
  order_id: string;
  status: string;
  sku: string;
  quantity: number;
  amount_minor: number;
  amount: number;
  currency: string;
}

export interface IOrderDeliveryBlock {
  code: string;
  source: string;
  supplier: string | null;
  delivered_at: string;
}

export interface IOrderDetailResponse {
  order_id: string;
  status: string;
  terminal: boolean;
  amount: number;
  currency: string;
  delivery: IOrderDeliveryBlock | null;
}

export interface IRaceTarget {
  extId: string;
  amountMajor: number;
  currency: string;
}
