import type { PAYMENT_EVENT_STATE, PAYMENT_STATUS } from './payments.constants';

export type PaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];

export type PaymentEventState = (typeof PAYMENT_EVENT_STATE)[keyof typeof PAYMENT_EVENT_STATE];

export type RawWebhookPayload = Record<string, unknown>;
