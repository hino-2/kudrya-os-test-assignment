import type { FulfillmentMode } from '../catalog/catalog.type';
import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import type { OrderStatus } from '../orders/orders.type';
import type { DeliveryOutcome } from './delivery.type';

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

export interface IFulfilInput {
  orderId: number;
  generation: number;
}

export interface IDeliveryResult {
  outcome: DeliveryOutcome;
  code: string | null;
}

export interface IFulfilmentService {
  readonly mode: FulfillmentMode;
  fulfil(input: IFulfilInput): Promise<IDeliveryResult>;
}
