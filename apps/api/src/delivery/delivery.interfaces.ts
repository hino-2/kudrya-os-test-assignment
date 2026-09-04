import type { FulfillmentMode } from '../catalog/catalog.type';
import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import type { OrderStatus } from '../orders/orders.type';
import type { SupplierCode, SupplierErrorKind } from '../suppliers/suppliers.type';
import type { AttemptState, DeliveryOutcome } from './delivery.type';

export interface ILockedOrderRow {
  id: number;
  ext_id: string;
  status: OrderStatus;
  generation: number;
  product_id: number;
  sku: string;
  amount_minor: MinorAmount;
  currency: CurrencyCode;
  fulfillment_mode: FulfillmentMode;
}

export interface IIssuedDeliveryRow {
  id: number;
  code: string;
}

export interface IInsertIssuedDeliveryInput {
  orderId: number;
  productId: number;
  sku: string;
  code: string;
  stockKeyId: number;
}

export interface IInsertSupplierIssuedDeliveryInput {
  orderId: number;
  productId: number;
  sku: string;
  code: string;
  supplierCode: SupplierCode;
  deliveryAttemptId: number;
}

export interface IDeliveryAttemptRow {
  id: number;
  order_id: number;
  supplier_code: SupplierCode;
  attempt_no: number;
  request_id: string;
  sku: string;
  state: AttemptState;
  http_status: number | null;
  response_code: string | null;
  error_kind: SupplierErrorKind | null;
  error_reason: string | null;
  resolve_attempts: number;
  next_resolve_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  duration_ms: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface IInsertDeliveryAttemptInput {
  orderId: number;
  supplierCode: SupplierCode;
  attemptNo: number;
  requestId: string;
  sku: string;
}

export interface IFinalizeAttemptSucceededInput {
  attemptId: number;
  httpStatus: number | null;
  responseCode: string;
  durationMs: number;
}

export interface IFinalizeAttemptFailedInput {
  attemptId: number;
  httpStatus: number | null;
  errorKind: SupplierErrorKind;
  errorReason: string | null;
  durationMs: number;
}

export interface IPromoteAttemptToUnknownInput {
  attemptId: number;
  httpStatus: number | null;
  errorKind: SupplierErrorKind;
  errorReason: string | null;
  nextResolveAt: Date;
}

export interface ISupplierPlanChoice {
  supplierCode: SupplierCode;
  attemptNo: number;
}

export interface IFulfilInput {
  orderId: number;
  generation: number;
  // опциональны: только deliver-order.handler.ts их прокидывает (см. README §5.5, форс delivery_failed на последней попытке джобы)
  attempts?: number;
  maxAttempts?: number;
}

export interface IDeliveryResult {
  outcome: DeliveryOutcome;
  code: string | null;
}

export interface IFulfilmentService {
  readonly mode: FulfillmentMode;
  fulfil(input: IFulfilInput): Promise<IDeliveryResult>;
}

export interface IPrepareStepTerminal {
  kind: 'terminal';
  result: IDeliveryResult;
}

export interface IPrepareStepAttempt {
  kind: 'attempt';
  attempt: IDeliveryAttemptRow;
  order: ILockedOrderRow;
}

export interface ISettleStepTerminal {
  kind: 'terminal';
  result: IDeliveryResult;
}

export interface ISettleStepRetryRequired {
  kind: 'retry_required';
  message: string;
}

export interface ISettleStepContinue {
  kind: 'continue';
  sleepMs: number | null;
}

export interface IStaleInflightAttemptRow {
  id: number;
  order_id: number;
  supplier_code: SupplierCode;
  attempt_no: number;
}

export interface IResolvableAttemptRow {
  id: number;
  order_id: number;
  ext_id: string;
  delivery_generation: number;
}
