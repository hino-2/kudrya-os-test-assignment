import { hasArg, intArg, parseArgs, stringArg } from './lib/args';
import { loadDotEnv } from './lib/env';
import { httpPost } from './lib/http';
import {
  API_BASE_URL_VAR,
  DEFAULT_API_BASE_URL,
  DEFAULT_CURRENCY,
  DEFAULT_TIMEOUT_MS,
  EVENT_ID_PREFIX,
  HELP_TEXT,
  INVALID_AMOUNT_MESSAGE,
  INVALID_STATUS_MESSAGE,
  MISSING_REQUIRED_ARGS_MESSAGE,
  PAYMENT_STATUS,
  REQUEST_FAILED_MESSAGE,
  WEBHOOK_PAYMENT_PATH,
} from './webhook.constants';
import type { IWebhookCliOptions, IWebhookPayload, IWebhookResponseBody } from './webhook.interfaces';
import type { WebhookPaymentStatus } from './webhook.type';

function isPaymentStatus(value: string): value is WebhookPaymentStatus {
  return value === PAYMENT_STATUS.PAID || value === PAYMENT_STATUS.FAILED;
}

function buildOptions(argv: string[]): IWebhookCliOptions {
  const args = parseArgs(argv);

  if (hasArg(args, 'help')) {
    console.log(HELP_TEXT);
    process.exit(0);
  }

  const order = stringArg(args, 'order');
  const status = stringArg(args, 'status');
  const amountRaw = stringArg(args, 'amount');

  if (order === undefined || status === undefined || amountRaw === undefined) {
    throw new Error(MISSING_REQUIRED_ARGS_MESSAGE);
  }

  if (!isPaymentStatus(status)) {
    throw new Error(`${INVALID_STATUS_MESSAGE}: "${status}"`);
  }

  const amount = Number(amountRaw);

  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error(`${INVALID_AMOUNT_MESSAGE}: "${amountRaw}"`);
  }

  return {
    order,
    status,
    amount,
    currency: stringArg(args, 'currency', DEFAULT_CURRENCY) as string,
    eventId: stringArg(args, 'event', `${EVENT_ID_PREFIX}${Date.now()}`) as string,
    createdAt: stringArg(args, 'created-at', new Date().toISOString()) as string,
    apiBaseUrl: stringArg(args, 'api', process.env[API_BASE_URL_VAR] ?? DEFAULT_API_BASE_URL) as string,
    timeoutMs: intArg(args, 'timeout-ms', DEFAULT_TIMEOUT_MS),
  };
}

function buildPayload(options: IWebhookCliOptions): IWebhookPayload {
  return {
    event_id: options.eventId,
    order_id: options.order,
    status: options.status,
    amount: options.amount,
    currency: options.currency,
    created_at: options.createdAt,
  };
}

function reportFailure(error: unknown): void {
  console.error('Ошибка при отправке вебхука:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

async function main(): Promise<void> {
  loadDotEnv();

  const options = buildOptions(process.argv.slice(2));
  const payload = buildPayload(options);
  const url = `${options.apiBaseUrl}${WEBHOOK_PAYMENT_PATH}`;

  console.log(`POST ${url}`);
  console.log(JSON.stringify(payload, null, 2));

  const result = await httpPost<IWebhookResponseBody>(url, payload, options.timeoutMs);

  if (!result.ok || result.body === null) {
    console.error(`${REQUEST_FAILED_MESSAGE}: status=${result.status} error=${result.error ?? 'нет тела ответа'}`);
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result.body, null, 2));
}

main().catch((error: unknown) => {
  reportFailure(error);
});
