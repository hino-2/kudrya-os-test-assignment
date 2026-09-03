import { boolFlag, hasArg, intArg, parseArgs, stringArg } from './lib/args';
import { loadDotEnv } from './lib/env';
import { httpGet, httpPost } from './lib/http';
import { CHECK_STATUS } from './lib/lib.constants';
import { printCheckTable, printTable } from './lib/table';
import type { ICheckRow, IHttpResult } from './lib/lib.interfaces';
import {
  ALL_CHECK_NAMES,
  API_BASE_URL_VAR,
  ATTEMPTS_TABLE_HEADERS,
  ATTEMPT_STATE,
  A_STOPPED_SKIP_MESSAGE,
  CATALOG_LOOKUP_FAILED_MESSAGE,
  CATALOG_PATH,
  CHECK_NAME,
  CONTROL_RESET_PATH,
  CONTROL_SCENARIO_PATH,
  CONTROL_STATE_PATH,
  DEFAULT_API_BASE_URL,
  DEFAULT_CURRENCY,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_SKU,
  DEFAULT_SUPPLIER_A_BASE_URL,
  DEFAULT_SUPPLIER_B_BASE_URL,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_WAIT_MS,
  DELIVERY_SOURCE_SUPPLIER,
  DEMO_FAILED_MESSAGE,
  EMPTY_CELL,
  EVENT_ID_PREFIX,
  EXPECTED_ERROR_KINDS,
  FAIL_MODE,
  FAIL_MODE_SCENARIO,
  FALLBACK_NOT_TRIGGERED_MESSAGE,
  HELP_TEXT,
  INVALID_FAIL_MODE_MESSAGE,
  NO_A_ATTEMPT_MESSAGE,
  NO_STUB_CONTROL_SKIP_MESSAGE,
  ORDERS_PATH,
  ORDER_CREATE_FAILED_MESSAGE,
  ORDER_LOOKUP_FAILED_MESSAGE,
  ORDER_NOT_DELIVERED_MESSAGE,
  ORDER_STATUS,
  PAYMENT_RESULT_APPLIED,
  POOL_PRODUCT_TYPE,
  POOL_SKU_MESSAGE,
  SCENARIOS_RESTORED_MESSAGE,
  SCENARIO_MODE,
  SETTLED_ORDER_STATUSES,
  STUB_STATE_UNAVAILABLE_MESSAGE,
  SUPPLIER_A_BASE_URL_VAR,
  SUPPLIER_B_BASE_URL_VAR,
  SUPPLIER_CODE,
  WEBHOOK_FAILED_MESSAGE,
  WEBHOOK_PAYMENT_PATH,
} from './demo-fallback.constants';
import type {
  ICatalogItemResponse,
  IDemoFallbackCliOptions,
  IDemoTarget,
  IOrderCreateResponse,
  IOrderDeliveryAttemptBlock,
  IOrderDetailResponse,
  IPollOutcome,
  IStubControlState,
  IStubSnapshot,
  IStubSnapshotPair,
  IWebhookPayload,
  IWebhookResultBody,
} from './demo-fallback.interfaces';
import type { FailMode, ScenarioMode } from './demo-fallback.type';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isFailMode(value: string): value is FailMode {
  return value === FAIL_MODE.ERROR_5XX || value === FAIL_MODE.BAD_REQUEST || value === FAIL_MODE.STOPPED;
}

function parseCliOptions(argv: string[]): IDemoFallbackCliOptions | undefined {
  const args = parseArgs(argv);

  if (hasArg(args, 'help')) {
    console.log(HELP_TEXT);
    process.exitCode = 0;
    return undefined;
  }

  const failModeRaw = stringArg(args, 'fail-mode', FAIL_MODE.ERROR_5XX) as string;

  if (!isFailMode(failModeRaw)) {
    throw new Error(`${INVALID_FAIL_MODE_MESSAGE}: "${failModeRaw}"`);
  }

  const amountRaw = stringArg(args, 'amount');

  return {
    order: stringArg(args, 'order'),
    sku: stringArg(args, 'sku', DEFAULT_SKU) as string,
    amount: amountRaw === undefined ? undefined : Number(amountRaw),
    currency: stringArg(args, 'currency', DEFAULT_CURRENCY) as string,
    failMode: failModeRaw,
    apiBaseUrl: stringArg(args, 'api', process.env[API_BASE_URL_VAR] ?? DEFAULT_API_BASE_URL) as string,
    supplierABaseUrl: stringArg(args, 'supplier-a', process.env[SUPPLIER_A_BASE_URL_VAR] ?? DEFAULT_SUPPLIER_A_BASE_URL) as string,
    supplierBBaseUrl: stringArg(args, 'supplier-b', process.env[SUPPLIER_B_BASE_URL_VAR] ?? DEFAULT_SUPPLIER_B_BASE_URL) as string,
    timeoutMs: intArg(args, 'timeout-ms', DEFAULT_TIMEOUT_MS),
    waitMs: intArg(args, 'wait-ms', DEFAULT_WAIT_MS),
    useStubControl: !boolFlag(args, 'no-stub-control'),
    resetStubs: boolFlag(args, 'reset-stubs'),
  };
}

async function forceScenario(baseUrl: string, mode: ScenarioMode, timeoutMs: number): Promise<void> {
  await httpPost(`${baseUrl}${CONTROL_SCENARIO_PATH}`, { mode }, timeoutMs);
}

async function resetStub(baseUrl: string, timeoutMs: number): Promise<void> {
  await httpPost(`${baseUrl}${CONTROL_RESET_PATH}`, {}, timeoutMs);
}

async function readStubSnapshot(baseUrl: string, timeoutMs: number): Promise<IStubSnapshot> {
  const result = await httpGet<IStubControlState>(`${baseUrl}${CONTROL_STATE_PATH}`, timeoutMs);

  if (!result.ok || result.body === null) {
    return { available: false, issuedCount: 0 };
  }

  return { available: true, issuedCount: result.body.issuedCount };
}

async function snapshotPair(options: IDemoFallbackCliOptions, skipA: boolean): Promise<IStubSnapshotPair> {
  const a = skipA ? { available: false, issuedCount: 0 } : await readStubSnapshot(options.supplierABaseUrl, options.timeoutMs);
  const b = options.useStubControl ? await readStubSnapshot(options.supplierBBaseUrl, options.timeoutMs) : { available: false, issuedCount: 0 };

  return { a, b };
}

async function resolveTarget(options: IDemoFallbackCliOptions): Promise<IDemoTarget> {
  if (options.order !== undefined) {
    if (options.amount !== undefined) {
      return { extId: options.order, sku: options.sku, amountMajor: options.amount, currency: options.currency };
    }

    const detail = await httpGet<IOrderDetailResponse>(`${options.apiBaseUrl}${ORDERS_PATH}/${options.order}`, options.timeoutMs);

    if (!detail.ok || detail.body === null) {
      throw new Error(`${ORDER_LOOKUP_FAILED_MESSAGE}: status=${detail.status} error=${detail.error ?? ''}`);
    }

    return { extId: options.order, sku: detail.body.sku, amountMajor: detail.body.amount, currency: detail.body.currency };
  }

  const created = await httpPost<IOrderCreateResponse>(`${options.apiBaseUrl}${ORDERS_PATH}`, { sku: options.sku }, options.timeoutMs);

  if (!created.ok || created.body === null) {
    throw new Error(`${ORDER_CREATE_FAILED_MESSAGE}: status=${created.status} error=${created.error ?? ''}`);
  }

  return {
    extId: created.body.order_id,
    sku: created.body.sku,
    amountMajor: options.amount ?? created.body.amount,
    currency: options.currency,
  };
}

async function fetchCatalogType(options: IDemoFallbackCliOptions, sku: string): Promise<string> {
  const result = await httpGet<ICatalogItemResponse>(`${options.apiBaseUrl}${CATALOG_PATH}/${sku}`, options.timeoutMs);

  if (!result.ok || result.body === null) {
    throw new Error(`${CATALOG_LOOKUP_FAILED_MESSAGE}: status=${result.status} error=${result.error ?? ''}`);
  }

  return result.body.type;
}

async function sendPayment(options: IDemoFallbackCliOptions, target: IDemoTarget): Promise<IHttpResult<IWebhookResultBody>> {
  const payload: IWebhookPayload = {
    event_id: `${EVENT_ID_PREFIX}${target.extId}`,
    order_id: target.extId,
    status: 'paid',
    amount: target.amountMajor,
    currency: target.currency,
    created_at: new Date().toISOString(),
  };

  return httpPost<IWebhookResultBody>(`${options.apiBaseUrl}${WEBHOOK_PAYMENT_PATH}`, payload, options.timeoutMs);
}

async function pollOrderUntilSettled(options: IDemoFallbackCliOptions, extId: string): Promise<IPollOutcome> {
  const startedAt = Date.now();
  const deadline = startedAt + options.waitMs;
  let detail: IOrderDetailResponse | null = null;

  while (Date.now() < deadline) {
    const result = await httpGet<IOrderDetailResponse>(`${options.apiBaseUrl}${ORDERS_PATH}/${extId}`, options.timeoutMs);

    if (result.ok && result.body !== null) {
      detail = result.body;

      if ((SETTLED_ORDER_STATUSES as readonly string[]).includes(detail.status)) {
        return { detail, settled: true, waitedMs: Date.now() - startedAt };
      }
    }

    await delay(DEFAULT_POLL_INTERVAL_MS);
  }

  return { detail, settled: false, waitedMs: Date.now() - startedAt };
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

function printAttemptsTable(attempts: IOrderDeliveryAttemptBlock[]): void {
  const rows = attempts.map((attempt) => [
    attempt.supplier,
    String(attempt.attempt_no),
    attempt.state,
    attempt.error_kind ?? EMPTY_CELL,
    attempt.request_id,
    attempt.duration_ms === null ? EMPTY_CELL : String(attempt.duration_ms),
  ]);

  printTable(ATTEMPTS_TABLE_HEADERS, rows);
}

function buildPaymentCheckRows(
  target: IDemoTarget,
  catalogType: string,
  payment: IHttpResult<IWebhookResultBody>,
): ICheckRow[] {
  const rows: ICheckRow[] = [];

  rows.push(
    catalogType !== POOL_PRODUCT_TYPE
      ? pass(CHECK_NAME.SKU_SUPPLIER_MODE, `sku=${target.sku}, type=${catalogType}`)
      : fail(CHECK_NAME.SKU_SUPPLIER_MODE, POOL_SKU_MESSAGE),
  );

  rows.push(pass(CHECK_NAME.ORDER_READY, `order_id=${target.extId}`));

  const applied =
    payment.status === 200 && payment.body !== null && payment.body.result === PAYMENT_RESULT_APPLIED && payment.body.order_status === ORDER_STATUS.PAID;

  rows.push(
    applied
      ? pass(CHECK_NAME.PAYMENT_APPLIED, `result=${payment.body?.result ?? EMPTY_CELL}`)
      : fail(CHECK_NAME.PAYMENT_APPLIED, `${WEBHOOK_FAILED_MESSAGE}: status=${payment.status} body=${JSON.stringify(payment.body)}`),
  );

  return rows;
}

function buildOrderRows(target: IDemoTarget, catalogType: string, payment: IHttpResult<IWebhookResultBody>, poll: IPollOutcome): ICheckRow[] {
  const rows = buildPaymentCheckRows(target, catalogType, payment);

  rows.push(
    poll.settled && poll.detail?.status === ORDER_STATUS.DELIVERED
      ? pass(CHECK_NAME.ORDER_DELIVERED, `status=${poll.detail.status}, waited_ms=${poll.waitedMs}`)
      : fail(CHECK_NAME.ORDER_DELIVERED, `${ORDER_NOT_DELIVERED_MESSAGE}: status=${poll.detail?.status ?? EMPTY_CELL}`),
  );

  const delivery = poll.detail?.delivery ?? null;
  const deliveredFromB = delivery?.source === DELIVERY_SOURCE_SUPPLIER && delivery.supplier === SUPPLIER_CODE.B;

  rows.push(
    deliveredFromB
      ? pass(CHECK_NAME.DELIVERY_FROM_B, `source=${delivery?.source}, supplier=${delivery?.supplier}`)
      : fail(CHECK_NAME.DELIVERY_FROM_B, `${FALLBACK_NOT_TRIGGERED_MESSAGE}: delivery=${JSON.stringify(delivery)}`),
  );

  return rows;
}

function buildAttemptRows(options: IDemoFallbackCliOptions, attempts: IOrderDeliveryAttemptBlock[]): ICheckRow[] {
  const rows: ICheckRow[] = [];
  const attemptA = attempts.find((attempt) => attempt.supplier === SUPPLIER_CODE.A);
  const attemptB = attempts.find((attempt) => attempt.supplier === SUPPLIER_CODE.B);
  const expectedKinds = EXPECTED_ERROR_KINDS[options.failMode];

  rows.push(
    attemptA !== undefined && attemptA.state === ATTEMPT_STATE.FAILED && attemptA.error_kind !== null && expectedKinds.includes(attemptA.error_kind)
      ? pass(CHECK_NAME.ATTEMPT_A_FAILED, `state=${attemptA.state}, error_kind=${attemptA.error_kind}`)
      : fail(CHECK_NAME.ATTEMPT_A_FAILED, attemptA === undefined ? NO_A_ATTEMPT_MESSAGE : `state=${attemptA.state}, error_kind=${attemptA.error_kind ?? EMPTY_CELL}`),
  );

  rows.push(
    attemptB !== undefined && attemptB.state === ATTEMPT_STATE.SUCCEEDED
      ? pass(CHECK_NAME.ATTEMPT_B_SUCCEEDED, `state=${attemptB.state}`)
      : fail(CHECK_NAME.ATTEMPT_B_SUCCEEDED, `state=${attemptB?.state ?? EMPTY_CELL}`),
  );

  const requestIdsDiffer = attemptA !== undefined && attemptB !== undefined && attemptA.request_id !== attemptB.request_id;

  rows.push(
    requestIdsDiffer
      ? pass(CHECK_NAME.REQUEST_IDS_DIFFER, `a=${attemptA?.request_id}, b=${attemptB?.request_id}`)
      : fail(CHECK_NAME.REQUEST_IDS_DIFFER, `a=${attemptA?.request_id ?? EMPTY_CELL}, b=${attemptB?.request_id ?? EMPTY_CELL}`),
  );

  const succeededCount = attempts.filter((attempt) => attempt.state === ATTEMPT_STATE.SUCCEEDED).length;

  rows.push(
    succeededCount === 1
      ? pass(CHECK_NAME.SINGLE_SUCCEEDED_ATTEMPT, `succeeded=${succeededCount}`)
      : fail(CHECK_NAME.SINGLE_SUCCEEDED_ATTEMPT, `succeeded=${succeededCount}, ожидалось 1`),
  );

  return rows;
}

function buildStubRows(options: IDemoFallbackCliOptions, before: IStubSnapshotPair, after: IStubSnapshotPair): ICheckRow[] {
  if (!options.useStubControl) {
    return [skip(CHECK_NAME.STUB_A_MINTED_NONE, NO_STUB_CONTROL_SKIP_MESSAGE), skip(CHECK_NAME.STUB_B_MINTED_ONE, NO_STUB_CONTROL_SKIP_MESSAGE)];
  }

  const rows: ICheckRow[] = [];

  if (options.failMode === FAIL_MODE.STOPPED) {
    rows.push(skip(CHECK_NAME.STUB_A_MINTED_NONE, A_STOPPED_SKIP_MESSAGE));
  } else if (!before.a.available || !after.a.available) {
    rows.push(skip(CHECK_NAME.STUB_A_MINTED_NONE, STUB_STATE_UNAVAILABLE_MESSAGE));
  } else {
    const mintedByA = after.a.issuedCount - before.a.issuedCount;

    rows.push(
      mintedByA === 0
        ? pass(CHECK_NAME.STUB_A_MINTED_NONE, `minted=${mintedByA}`)
        : fail(CHECK_NAME.STUB_A_MINTED_NONE, `minted=${mintedByA}, ожидалось 0`),
    );
  }

  if (!before.b.available || !after.b.available) {
    rows.push(skip(CHECK_NAME.STUB_B_MINTED_ONE, STUB_STATE_UNAVAILABLE_MESSAGE));
  } else {
    const mintedByB = after.b.issuedCount - before.b.issuedCount;

    rows.push(
      mintedByB === 1
        ? pass(CHECK_NAME.STUB_B_MINTED_ONE, `minted=${mintedByB}`)
        : fail(CHECK_NAME.STUB_B_MINTED_ONE, `minted=${mintedByB}, ожидалось 1`),
    );
  }

  return rows;
}

function buildSkippedRows(names: readonly string[], reason: string): ICheckRow[] {
  return names.map((name) => skip(name, reason));
}

async function main(): Promise<void> {
  loadDotEnv();

  const options = parseCliOptions(process.argv.slice(2));

  if (options === undefined) {
    return;
  }

  const targetLabel = options.order !== undefined ? `order=${options.order}` : `sku=${options.sku}`;

  console.log(`Демо фолбэка A->B: fail-mode=${options.failMode}, ${targetLabel}`);
  console.log(`api=${options.apiBaseUrl} supplier-a=${options.supplierABaseUrl} supplier-b=${options.supplierBBaseUrl}`);

  const aStopped = options.failMode === FAIL_MODE.STOPPED;

  if (options.resetStubs && options.useStubControl) {
    await resetStub(options.supplierBBaseUrl, options.timeoutMs);

    if (!aStopped) {
      await resetStub(options.supplierABaseUrl, options.timeoutMs);
    }
  }

  if (options.useStubControl) {
    await forceScenario(options.supplierBBaseUrl, SCENARIO_MODE.OK, options.timeoutMs);

    const aMode = FAIL_MODE_SCENARIO[options.failMode];

    if (aMode !== null) {
      await forceScenario(options.supplierABaseUrl, aMode, options.timeoutMs);
    }

    console.log(`Сценарии стендов выставлены: B=${SCENARIO_MODE.OK}${aMode !== null ? `, A=${aMode}` : ', A не тронут (--fail-mode stopped)'}`);
  }

  const before = await snapshotPair(options, aStopped);

  try {
    const target = await resolveTarget(options);

    console.log(`Заказ ${target.extId}: sku=${target.sku}, amount=${target.amountMajor} ${target.currency}`);

    const catalogType = await fetchCatalogType(options, target.sku);

    if (catalogType === POOL_PRODUCT_TYPE) {
      printCheckTable([fail(CHECK_NAME.SKU_SUPPLIER_MODE, POOL_SKU_MESSAGE), ...buildSkippedRows(ALL_CHECK_NAMES.slice(1), POOL_SKU_MESSAGE)]);
      process.exitCode = 1;
      return;
    }

    const payment = await sendPayment(options, target);
    const paymentOk =
      payment.status === 200 && payment.body !== null && payment.body.result === PAYMENT_RESULT_APPLIED && payment.body.order_status === ORDER_STATUS.PAID;

    if (!paymentOk) {
      printCheckTable([...buildPaymentCheckRows(target, catalogType, payment), ...buildSkippedRows(ALL_CHECK_NAMES.slice(3), WEBHOOK_FAILED_MESSAGE)]);
      process.exitCode = 1;
      return;
    }

    const poll = await pollOrderUntilSettled(options, target.extId);
    const after = await snapshotPair(options, aStopped);
    const attempts = poll.detail?.delivery_attempts ?? [];

    printAttemptsTable(attempts);

    const ok = printCheckTable([
      ...buildOrderRows(target, catalogType, payment, poll),
      ...buildAttemptRows(options, attempts),
      ...buildStubRows(options, before, after),
    ]);

    process.exitCode = ok ? 0 : 1;
  } finally {
    if (options.useStubControl) {
      await forceScenario(options.supplierBBaseUrl, SCENARIO_MODE.NORMAL, options.timeoutMs);

      if (!aStopped) {
        await forceScenario(options.supplierABaseUrl, SCENARIO_MODE.NORMAL, options.timeoutMs);
      }

      console.log(SCENARIOS_RESTORED_MESSAGE);
    }
  }
}

main().catch((error: unknown) => {
  console.error(DEMO_FAILED_MESSAGE, error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
