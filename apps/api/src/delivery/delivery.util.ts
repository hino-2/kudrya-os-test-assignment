import type { IDeliverOrderPayload } from '../jobs/jobs.interfaces';
import {
  ALL_SUPPLIERS_FAILED_MESSAGE_TEMPLATE,
  DELIVERY_ATTEMPT_UNKNOWN_RETRY_MESSAGE_TEMPLATE,
  ORDER_NOT_FOUND_FOR_DELIVERY_MESSAGE_TEMPLATE,
  SUPPLIER_JOB_LAST_ATTEMPT_MESSAGE_TEMPLATE,
  UNKNOWN_FULFILLMENT_MODE_MESSAGE_TEMPLATE,
} from './delivery.constants';

function formatTemplate(template: string, ...values: readonly unknown[]): string {
  let index = 0;

  return template.replace(/%s/g, () => String(values[index++]));
}

export function buildOrderNotFoundMessage(orderId: number): string {
  return formatTemplate(ORDER_NOT_FOUND_FOR_DELIVERY_MESSAGE_TEMPLATE, orderId);
}

export function buildUnknownFulfillmentModeMessage(mode: string): string {
  return formatTemplate(UNKNOWN_FULFILLMENT_MODE_MESSAGE_TEMPLATE, mode);
}

export function buildDeliveryAttemptUnknownRetryMessage(requestId: string): string {
  return formatTemplate(DELIVERY_ATTEMPT_UNKNOWN_RETRY_MESSAGE_TEMPLATE, requestId);
}

export function buildAllSuppliersFailedMessage(reason: string): string {
  return formatTemplate(ALL_SUPPLIERS_FAILED_MESSAGE_TEMPLATE, reason);
}

export function buildSupplierJobLastAttemptMessage(reason: string): string {
  return formatTemplate(SUPPLIER_JOB_LAST_ATTEMPT_MESSAGE_TEMPLATE, reason);
}

// payload из jobs.payload приходит как unknown Record — сборка происходит только в этом же
// приложении (payment-webhook.service.ts), но границу всё равно стоит проверить рантаймом.
export function isDeliverOrderPayload(payload: unknown): payload is IDeliverOrderPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }

  const candidate = payload as Record<string, unknown>;

  return (
    typeof candidate.orderId === 'number' &&
    typeof candidate.ext_id === 'string' &&
    typeof candidate.generation === 'number'
  );
}
