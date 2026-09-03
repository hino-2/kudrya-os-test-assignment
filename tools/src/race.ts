import type { Client } from 'pg';

import { boolFlag, hasArg, intArg, parseArgs, stringArg } from './lib/args';
import { connectClient, toSafeInt } from './lib/db';
import { loadDotEnv, requireEnv } from './lib/env';
import { httpGet, httpPost } from './lib/http';
import { CHECK_STATUS } from './lib/lib.constants';
import { printCheckTable } from './lib/table';
import type { ICheckRow } from './lib/lib.interfaces';
import {
  API_BASE_URL_VAR,
  CASH_DEBIT_SUMMARY_BY_ORDER_ID_SQL,
  CONTROL_RESET_PATH,
  CONTROL_SCENARIO_PATH,
  COUNT_APPLIED_PAYMENT_EVENTS_SQL,
  COUNT_DELIVER_ORDER_JOBS_SQL,
  COUNT_ISSUED_DELIVERIES_BY_ORDER_ID_SQL,
  COUNT_LEDGER_ENTRIES_BY_ORDER_ID_SQL,
  COUNT_LEDGER_TXNS_BY_ORDER_ID_SQL,
  COUNT_PAYMENT_EVENTS_BY_ORDER_SQL,
  COUNT_STOCK_KEYS_BY_ORDER_ID_SQL,
  COUNT_SUCCEEDED_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL,
  COUNT_UNEXPECTED_PAYMENT_EVENTS_SQL,
  DATABASE_URL_VAR,
  DEFAULT_API_BASE_URL,
  DEFAULT_CURRENCY,
  DEFAULT_EVENT_COUNT,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_SKU,
  DEFAULT_SUPPLIER_A_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  EVENT_ID_PREFIX,
  FULFILLMENT_MODE,
  HELP_TEXT,
  JOB_DEDUPE_ORDER_PREFIX,
  JOB_STATE_DONE,
  MISSING_ORDER_OR_SKU_MESSAGE,
  ORDERS_PATH,
  ORDER_CREATE_FAILED_MESSAGE,
  ORDER_LOOKUP_FAILED_MESSAGE,
  ORDER_NOT_DELIVERED_MESSAGE,
  PAYMENT_RESULT,
  RACE_JITTER_MAX_MS,
  RACE_PRNG_SEED,
  SCENARIO_MODE_NORMAL,
  SCENARIO_MODE_OK,
  SELECT_DELIVER_ORDER_JOB_STATE_SQL,
  SELECT_FULFILLMENT_MODE_BY_ORDER_ID_SQL,
  SELECT_ORDER_ID_BY_EXT_ID_SQL,
  SUM_SIGNED_MINOR_BY_ORDER_ID_SQL,
  SUPPLIER_A_BASE_URL_VAR,
  WEBHOOK_PAYMENT_PATH,
} from './race.constants';
import type {
  IOrderCreateResponse,
  IOrderDetailResponse,
  IRaceCliOptions,
  IRacePayload,
  IRaceTarget,
  IWebhookResultBody,
} from './race.interfaces';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// mulberry32 — тот же приём, что и в apps/api/test/helpers/race.constants.ts/race.helper.ts,
// продублирован намеренно: tools — отдельный npm-workspace, код apps/api/test ему недоступен
function createPrng(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;

    let t = state;

    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildRaceEvents(target: IRaceTarget, count: number, baseCreatedAtMs: number): IRacePayload[] {
  const next = createPrng(RACE_PRNG_SEED);
  const events: IRacePayload[] = [];

  for (let i = 0; i < count; i += 1) {
    const jitterMs = Math.round(next() * RACE_JITTER_MAX_MS - RACE_JITTER_MAX_MS / 2);

    events.push({
      event_id: `${EVENT_ID_PREFIX}${target.extId}_${i}`,
      order_id: target.extId,
      status: 'paid',
      amount: target.amountMajor,
      currency: target.currency,
      created_at: new Date(baseCreatedAtMs + jitterMs).toISOString(),
    });
  }

  return events;
}

function parseCliOptions(argv: string[]): IRaceCliOptions | undefined {
  const args = parseArgs(argv);

  if (hasArg(args, 'help')) {
    console.log(HELP_TEXT);
    process.exitCode = 0;
    return undefined;
  }

  const order = stringArg(args, 'order');
  const sku = stringArg(args, 'sku');

  if (order === undefined && sku === undefined) {
    throw new Error(MISSING_ORDER_OR_SKU_MESSAGE);
  }

  const amountRaw = stringArg(args, 'amount');

  return {
    order,
    sku,
    count: intArg(args, 'count', DEFAULT_EVENT_COUNT),
    amount: amountRaw === undefined ? undefined : Number(amountRaw),
    currency: stringArg(args, 'currency', DEFAULT_CURRENCY) as string,
    apiBaseUrl: stringArg(args, 'api', process.env[API_BASE_URL_VAR] ?? DEFAULT_API_BASE_URL) as string,
    supplierABaseUrl: process.env[SUPPLIER_A_BASE_URL_VAR] ?? DEFAULT_SUPPLIER_A_BASE_URL,
    timeoutMs: intArg(args, 'timeout-ms', DEFAULT_TIMEOUT_MS),
    useDb: !boolFlag(args, 'no-db'),
    useStubControl: !boolFlag(args, 'no-stub-control'),
    resetStubs: boolFlag(args, 'reset-stubs'),
  };
}

async function resolveTarget(options: IRaceCliOptions): Promise<IRaceTarget> {
  if (options.order !== undefined) {
    if (options.amount !== undefined) {
      return { extId: options.order, amountMajor: options.amount, currency: options.currency };
    }

    const detail = await httpGet<IOrderDetailResponse>(`${options.apiBaseUrl}${ORDERS_PATH}/${options.order}`, options.timeoutMs);

    if (!detail.ok || detail.body === null) {
      throw new Error(`${ORDER_LOOKUP_FAILED_MESSAGE}: status=${detail.status} error=${detail.error ?? ''}`);
    }

    return { extId: options.order, amountMajor: detail.body.amount, currency: detail.body.currency };
  }

  const sku = options.sku ?? DEFAULT_SKU;
  const created = await httpPost<IOrderCreateResponse>(`${options.apiBaseUrl}${ORDERS_PATH}`, { sku }, options.timeoutMs);

  if (!created.ok || created.body === null) {
    throw new Error(`${ORDER_CREATE_FAILED_MESSAGE}: status=${created.status} error=${created.error ?? ''}`);
  }

  return {
    extId: created.body.order_id,
    amountMajor: options.amount ?? created.body.amount,
    currency: options.currency,
  };
}

async function pollOrderUntilTerminalDelivery(
  options: IRaceCliOptions,
  extId: string,
): Promise<{ ok: boolean; last: IOrderDetailResponse | null }> {
  const deadline = Date.now() + DEFAULT_POLL_TIMEOUT_MS;
  let last: IOrderDetailResponse | null = null;

  while (Date.now() < deadline) {
    const result = await httpGet<IOrderDetailResponse>(`${options.apiBaseUrl}${ORDERS_PATH}/${extId}`, options.timeoutMs);

    if (result.ok && result.body !== null) {
      last = result.body;

      if (result.body.terminal) {
        return { ok: true, last };
      }
    }

    await delay(DEFAULT_POLL_INTERVAL_MS);
  }

  return { ok: false, last };
}

function pass(name: string, detail: string): ICheckRow {
  return { name, status: CHECK_STATUS.PASS, detail };
}

function fail(name: string, detail: string): ICheckRow {
  return { name, status: CHECK_STATUS.FAIL, detail };
}

function skip(name: string, detail: string): ICheckRow {
  return { name, status: CHECK_STATUS.SKIP, detail };
}

function runHttpChecks(results: { status: number; body: IWebhookResultBody | null }[]): ICheckRow[] {
  const rows: ICheckRow[] = [];
  const allHttp200 = results.every((result) => result.status === 200);

  rows.push(allHttp200 ? pass('http-200', 'все ответы вебхука — HTTP 200') : fail('http-200', 'встретился ответ не 200'));

  const applied = results.filter((result) => result.body?.result === PAYMENT_RESULT.APPLIED).length;

  rows.push(applied === 1 ? pass('exactly-one-applied', `applied=${applied}`) : fail('exactly-one-applied', `applied=${applied}`));

  const unexpected = results.filter((result) =>
    [PAYMENT_RESULT.DUPLICATE, PAYMENT_RESULT.CONFLICT, PAYMENT_RESULT.REJECTED_AMOUNT, PAYMENT_RESULT.ORPHAN].includes(
      (result.body?.result ?? '') as never,
    ),
  ).length;

  rows.push(unexpected === 0 ? pass('no-unexpected-results', 'нет duplicate/conflict/rejected_amount/orphan') : fail('no-unexpected-results', `unexpected=${unexpected}`));

  const otherAllowed = results.every((result) =>
    result.body === null
      ? false
      : [PAYMENT_RESULT.APPLIED, PAYMENT_RESULT.IGNORED_STALE, PAYMENT_RESULT.IGNORED_ALREADY_PAID].includes(result.body.result as never),
  );

  rows.push(
    otherAllowed
      ? pass('remaining-results-known', 'все результаты — applied/ignored_stale/ignored_already_paid')
      : fail('remaining-results-known', 'встретился неожиданный result'),
  );

  return rows;
}

async function runDeliveryChecks(options: IRaceCliOptions, extId: string): Promise<{ rows: ICheckRow[]; delivery: IOrderDetailResponse | null }> {
  const rows: ICheckRow[] = [];
  const lookup = await httpGet<IOrderDetailResponse>(`${options.apiBaseUrl}${ORDERS_PATH}/${extId}`, options.timeoutMs);

  rows.push(lookup.ok && lookup.body !== null ? pass('order-lookup', 'GET /orders/:orderId вернул 200') : fail('order-lookup', `status=${lookup.status}`));

  const { ok: reachedTerminal, last } = await pollOrderUntilTerminalDelivery(options, extId);

  rows.push(reachedTerminal ? pass('order-terminal', `status=${last?.status ?? 'unknown'}`) : fail('order-terminal', ORDER_NOT_DELIVERED_MESSAGE));

  rows.push(
    last?.delivery !== null && last?.delivery !== undefined
      ? pass('delivery-code-present', `code=${last.delivery.code}`)
      : fail('delivery-code-present', 'delivery=null'),
  );

  return { rows, delivery: last };
}

function buildSkippedDbRows(): ICheckRow[] {
  return [
    skip('payment-events-total', '--no-db'),
    skip('payment-events-applied', '--no-db'),
    skip('deliver-order-job-count', '--no-db'),
    skip('deliver-order-job-done', '--no-db'),
    skip('issued-deliveries-count', '--no-db'),
    skip('ledger-txns-count', '--no-db'),
    skip('ledger-entries-count', '--no-db'),
    skip('ledger-balanced', '--no-db'),
    skip('cash-debit-and-fulfilment', '--no-db'),
  ];
}

async function runDbChecks(client: Client, options: IRaceCliOptions, extId: string): Promise<ICheckRow[]> {
  const rows: ICheckRow[] = [];
  const orderRow = await client.query<{ id: string }>(SELECT_ORDER_ID_BY_EXT_ID_SQL, [extId]);
  const orderIdRaw = orderRow.rows[0]?.id;

  if (orderIdRaw === undefined) {
    const reason = `заказ ${extId} не найден в БД`;

    return [
      fail('payment-events-total', reason),
      fail('payment-events-applied', reason),
      fail('deliver-order-job-count', reason),
      fail('deliver-order-job-done', reason),
      fail('issued-deliveries-count', reason),
      fail('ledger-txns-count', reason),
      fail('ledger-entries-count', reason),
      fail('ledger-balanced', reason),
      fail('cash-debit-and-fulfilment', reason),
    ];
  }

  const orderId = orderIdRaw;
  const dedupeKey = `${JOB_DEDUPE_ORDER_PREFIX}${extId}`;

  const eventsTotal = await client.query<{ count: number }>(COUNT_PAYMENT_EVENTS_BY_ORDER_SQL, [extId]);
  const total = eventsTotal.rows[0]?.count ?? 0;

  rows.push(total === options.count ? pass('payment-events-total', `count=${total}`) : fail('payment-events-total', `count=${total}, ожидалось ${options.count}`));

  const unexpectedStates = await client.query<{ count: number }>(COUNT_UNEXPECTED_PAYMENT_EVENTS_SQL, [extId]);
  const eventsApplied = await client.query<{ count: number }>(COUNT_APPLIED_PAYMENT_EVENTS_SQL, [extId]);
  const applied = eventsApplied.rows[0]?.count ?? 0;
  const unexpected = unexpectedStates.rows[0]?.count ?? 0;

  rows.push(
    applied === 1 && unexpected === 0
      ? pass('payment-events-applied', `applied=${applied}`)
      : fail('payment-events-applied', `applied=${applied}, unexpected_state=${unexpected}`),
  );

  const jobCount = await client.query<{ count: number }>(COUNT_DELIVER_ORDER_JOBS_SQL, [dedupeKey]);
  const jobs = jobCount.rows[0]?.count ?? 0;

  rows.push(jobs === 1 ? pass('deliver-order-job-count', `jobs=${jobs}`) : fail('deliver-order-job-count', `jobs=${jobs}, ожидалось 1`));

  const jobStateRow = await client.query<{ state: string }>(SELECT_DELIVER_ORDER_JOB_STATE_SQL, [dedupeKey]);
  const jobState = jobStateRow.rows[0]?.state;

  rows.push(jobState === JOB_STATE_DONE ? pass('deliver-order-job-done', `state=${jobState}`) : fail('deliver-order-job-done', `state=${String(jobState)}`));

  const issued = await client.query<{ count: number }>(COUNT_ISSUED_DELIVERIES_BY_ORDER_ID_SQL, [orderId]);
  const issuedCount = issued.rows[0]?.count ?? 0;

  rows.push(issuedCount === 1 ? pass('issued-deliveries-count', `count=${issuedCount}`) : fail('issued-deliveries-count', `count=${issuedCount}, ожидалось 1`));

  const txns = await client.query<{ count: number }>(COUNT_LEDGER_TXNS_BY_ORDER_ID_SQL, [orderId]);
  const txnCount = txns.rows[0]?.count ?? 0;

  rows.push(txnCount === 2 ? pass('ledger-txns-count', `count=${txnCount}`) : fail('ledger-txns-count', `count=${txnCount}, ожидалось 2`));

  const entries = await client.query<{ count: number }>(COUNT_LEDGER_ENTRIES_BY_ORDER_ID_SQL, [orderId]);
  const entryCount = entries.rows[0]?.count ?? 0;

  rows.push(entryCount === 4 ? pass('ledger-entries-count', `count=${entryCount}`) : fail('ledger-entries-count', `count=${entryCount}, ожидалось 4`));

  const balance = await client.query<{ sum: string }>(SUM_SIGNED_MINOR_BY_ORDER_ID_SQL, [orderId]);
  const sum = balance.rows[0] === undefined ? -1 : toSafeInt(balance.rows[0].sum, 'ledger-balanced.sum');

  rows.push(sum === 0 ? pass('ledger-balanced', `sum=${sum}`) : fail('ledger-balanced', `sum=${sum}, ожидалось 0`));

  const cash = await client.query<{ count: number; sum: string }>(CASH_DEBIT_SUMMARY_BY_ORDER_ID_SQL, [orderId]);
  const cashCount = cash.rows[0]?.count ?? 0;
  const cashSum = cash.rows[0] === undefined ? -1 : toSafeInt(cash.rows[0].sum, 'cash-debit.sum');
  const modeRow = await client.query<{ fulfillment_mode: string }>(SELECT_FULFILLMENT_MODE_BY_ORDER_ID_SQL, [orderId]);
  const mode = modeRow.rows[0]?.fulfillment_mode;
  let fulfilmentOk = false;
  let fulfilmentDetail = `mode=${String(mode)}`;

  if (mode === FULFILLMENT_MODE.POOL) {
    const keys = await client.query<{ count: number }>(COUNT_STOCK_KEYS_BY_ORDER_ID_SQL, [orderId]);
    const keyCount = keys.rows[0]?.count ?? 0;

    fulfilmentOk = keyCount === 1;
    fulfilmentDetail = `pool: stock_keys=${keyCount}`;
  } else if (mode === FULFILLMENT_MODE.SUPPLIER) {
    const succeeded = await client.query<{ count: number }>(COUNT_SUCCEEDED_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL, [orderId]);
    const succeededCount = succeeded.rows[0]?.count ?? 0;

    fulfilmentOk = succeededCount === 1;
    fulfilmentDetail = `supplier: succeeded_attempts=${succeededCount}`;
  }

  rows.push(
    cashCount === 1 && fulfilmentOk
      ? pass('cash-debit-and-fulfilment', `cash_debit=${cashCount}/${cashSum}, ${fulfilmentDetail}`)
      : fail('cash-debit-and-fulfilment', `cash_debit=${cashCount}/${cashSum}, ${fulfilmentDetail}`),
  );

  return rows;
}

async function main(): Promise<void> {
  loadDotEnv();

  const options = parseCliOptions(process.argv.slice(2));

  if (options === undefined) {
    return;
  }

  const target = await resolveTarget(options);

  console.log(`Гонка против заказа ${target.extId}: ${options.count} параллельных вебхуков, amount=${target.amountMajor} ${target.currency}`);

  if (options.resetStubs) {
    await httpPost(`${options.supplierABaseUrl}${CONTROL_RESET_PATH}`, {}, options.timeoutMs);
  }

  if (options.useStubControl) {
    await httpPost(`${options.supplierABaseUrl}${CONTROL_SCENARIO_PATH}`, { mode: SCENARIO_MODE_OK }, options.timeoutMs);
  }

  try {
    const events = buildRaceEvents(target, options.count, Date.now());
    const results = await Promise.all(
      events.map((event) => httpPost<IWebhookResultBody>(`${options.apiBaseUrl}${WEBHOOK_PAYMENT_PATH}`, event, options.timeoutMs)),
    );
    const httpRows = runHttpChecks(results);
    const { rows: deliveryRows } = await runDeliveryChecks(options, target.extId);
    let dbRows: ICheckRow[];

    if (options.useDb) {
      const client = await connectClient(requireEnv(DATABASE_URL_VAR));

      try {
        dbRows = await runDbChecks(client, options, target.extId);
      } finally {
        await client.end().catch(() => undefined);
      }
    } else {
      dbRows = buildSkippedDbRows();
    }

    const ok = printCheckTable([...httpRows, ...deliveryRows, ...dbRows]);

    process.exitCode = ok ? 0 : 1;
  } finally {
    if (options.useStubControl) {
      await httpPost(`${options.supplierABaseUrl}${CONTROL_SCENARIO_PATH}`, { mode: SCENARIO_MODE_NORMAL }, options.timeoutMs);
    }
  }
}

main().catch((error: unknown) => {
  console.error('Ошибка прогона гонки:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
