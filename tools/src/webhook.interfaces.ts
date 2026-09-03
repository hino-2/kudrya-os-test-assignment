import type { WebhookPaymentStatus } from './webhook.type';

export interface IWebhookCliOptions {
  order: string;
  status: WebhookPaymentStatus;
  amount: number;
  currency: string;
  eventId: string;
  createdAt: string;
  apiBaseUrl: string;
  timeoutMs: number;
}

export interface IWebhookPayload {
  event_id: string;
  order_id: string;
  status: WebhookPaymentStatus;
  amount: number;
  currency: string;
  created_at: string;
}

export interface IWebhookResponseBody {
  accepted: boolean;
  result: string;
  order_status: string;
  event_id: string;
}
