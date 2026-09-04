import type { FulfillmentMode, ProductType } from '../catalog/catalog.type';
import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import type { TRANSITION_KIND } from './orders.constants';
import type { OrderStatus } from './orders.type';
import type { CreateOrderResponseDto } from './dto/create-order.response.dto';

export interface ITransitionApplyRule {
  kind: typeof TRANSITION_KIND.APPLY;
  to: OrderStatus;
}

export interface ITransitionPassiveRule {
  kind: typeof TRANSITION_KIND.NOOP | typeof TRANSITION_KIND.CONFLICT;
}

export interface IOrderRow {
  id: number;
  ext_id: string;
  product_id: number;
  sku: string;
  quantity: number;
  unit_price_minor: MinorAmount;
  total_minor: MinorAmount;
  currency: CurrencyCode;
  status: OrderStatus;
  buyer_email: string | null;
  failure_reason: string | null;
  delivery_generation: number;
  last_payment_event_id: string | null;
  last_payment_event_at: Date | null;
  paid_at: Date | null;
  delivering_at: Date | null;
  delivered_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface IOrderMutablePatch {
  paidAt?: Date | null;
  deliveringAt?: Date | null;
  deliveredAt?: Date | null;
  failureReason?: string | null;
  deliveryGeneration?: number;
  lastPaymentEventId?: string | null;
  lastPaymentEventAt?: Date | null;
}

export interface IProductSnapshotRow {
  id: number;
  sku: string;
  type: ProductType;
  price_minor: MinorAmount;
  currency: CurrencyCode;
  fulfillment_mode: FulfillmentMode;
  is_active: boolean;
}

export interface IOrderDraft {
  extId: string;
  productId: number;
  sku: string;
  quantity: number;
  unitPriceMinor: MinorAmount;
  totalMinor: MinorAmount;
  currency: CurrencyCode;
  buyerEmail: string | null;
}

export interface ICreateOrderOutcome {
  created: boolean;
  order: CreateOrderResponseDto;
}

export interface IIssuedDeliveryRow {
  code: string;
  source: string;
  supplier_code: string | null;
  delivered_at: Date;
}

export interface IPaymentEventRow {
  event_id: string;
  status: string;
  state: string;
  occurred_at: Date;
  received_at: Date;
}

export interface IDeliveryAttemptRow {
  supplier_code: string;
  attempt_no: number;
  request_id: string;
  state: string;
  error_kind: string | null;
  duration_ms: number | null;
}

export interface IOrderDetail {
  order: IOrderRow;
  delivery: IIssuedDeliveryRow | null;
  paymentEvents: IPaymentEventRow[];
  deliveryAttempts: IDeliveryAttemptRow[];
}

export interface IExtIdRow {
  ext_id: string;
}

export interface IStuckDeliveryOrderRow {
  id: number;
  ext_id: string;
  delivery_generation: number;
}

export interface IRecoverableOrderRow {
  id: number;
  ext_id: string;
  status: OrderStatus;
  delivery_generation: number;
}
