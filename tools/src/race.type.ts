import type { FULFILLMENT_MODE, PAYMENT_RESULT } from './race.constants';

export type PaymentResult = (typeof PAYMENT_RESULT)[keyof typeof PAYMENT_RESULT];

export type FulfillmentMode = (typeof FULFILLMENT_MODE)[keyof typeof FULFILLMENT_MODE];
