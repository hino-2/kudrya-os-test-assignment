import type { PAYMENT_STATUS } from './webhook.constants';

export type WebhookPaymentStatus = (typeof PAYMENT_STATUS)[keyof typeof PAYMENT_STATUS];
