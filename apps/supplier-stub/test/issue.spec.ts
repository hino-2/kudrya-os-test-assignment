import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CODE_ALPHABET, CODE_GROUP_COUNT, CODE_GROUP_LENGTH, CODE_SEPARATOR } from '../src/config/stub-config.constants';
import { SCENARIO_MODE } from '../src/scenario/scenario.constants';
import { startStub } from './helpers/app.harness';
import type { IStubHarness } from './helpers/harness.interfaces';

interface IHttpResult<T> {
  status: number;
  body: T;
}

interface IIssueResultBody {
  requestId: string;
  sku: string;
  orderId: string;
  code: string;
  issuedAt: string;
  replayed: boolean;
}

interface IErrorBody {
  status: string;
  reason: string;
}

const codeGroup = `[${CODE_ALPHABET}]{${CODE_GROUP_LENGTH}}`;
const CODE_REGEX = new RegExp(`^${codeGroup}(?:\\${CODE_SEPARATOR}${codeGroup}){${CODE_GROUP_COUNT - 1}}$`);

const TEST_ENV = {
  SUPPLIER_ID: 'A',
  STUB_FAIL_RATE: '0',
  STUB_TIMEOUT_RATE: '0',
  STUB_SLOW_RATE: '0',
  STUB_LATENCY_MS_MIN: '10',
  STUB_LATENCY_MS_MAX: '30',
  STUB_HANG_MS: '50',
  STUB_INVENTORY_SIZE: '100',
  STUB_CONTROL_ENABLED: 'true',
  STUB_PERSIST_PATH: '',
  LOG_LEVEL: 'error',
};

const NO_RESPONSE_TIMEOUT_MS = 300;

function newRequestId(): string {
  return randomUUID();
}

async function postJson<T>(baseUrl: string, path: string, payload: unknown): Promise<IHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();

  return { status: response.status, body: (text.length > 0 ? JSON.parse(text) : {}) as T };
}

async function postRaw(baseUrl: string, path: string, payload: unknown): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();

  return { status: response.status, text };
}

async function getJson<T>(baseUrl: string, path: string): Promise<IHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();

  return { status: response.status, body: (text.length > 0 ? JSON.parse(text) : {}) as T };
}

async function issueExpectNoResponse(baseUrl: string, payload: unknown): Promise<void> {
  await expect(
    fetch(`${baseUrl}/issue`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(NO_RESPONSE_TIMEOUT_MS),
    }),
  ).rejects.toBeTruthy();
}

async function forceScenario(baseUrl: string, mode: string, times?: number): Promise<void> {
  await postJson(baseUrl, '/_control/scenario', times === undefined ? { mode } : { mode, times });
}

describe('supplier-stub /issue', () => {
  let harness: IStubHarness;

  beforeAll(async () => {
    harness = await startStub(TEST_ENV);
  });

  afterAll(async () => {
    await harness.stop();
  });

  beforeEach(async () => {
    await postJson(harness.baseUrl, '/_control/reset', {});
  });

  it('mints a code matching the XXXX-XXXX-XXXX shape on a normal issue', async () => {
    const requestId = newRequestId();
    const result = await postJson<IIssueResultBody>(harness.baseUrl, '/issue', {
      request_id: requestId,
      sku: 'KEY-CS2-PRIME',
      order_id: 'order-1',
    });

    expect(result.status).toBe(200);
    expect(result.body.replayed).toBe(false);
    expect(result.body.code).toMatch(CODE_REGEX);
  });

  it('is idempotent for a repeated request_id, sequentially', async () => {
    const requestId = newRequestId();
    const payload = { request_id: requestId, sku: 'KEY-CS2-PRIME', order_id: 'order-2' };

    const first = await postJson<IIssueResultBody>(harness.baseUrl, '/issue', payload);
    const second = await postJson<IIssueResultBody>(harness.baseUrl, '/issue', payload);

    expect(first.body.replayed).toBe(false);
    expect(second.body.replayed).toBe(true);
    expect(second.body.code).toBe(first.body.code);
  });

  it('is idempotent for a repeated request_id issued concurrently', async () => {
    const requestId = newRequestId();
    const payload = { request_id: requestId, sku: 'KEY-CS2-PRIME', order_id: 'order-3' };

    const results = await Promise.all(
      Array.from({ length: 5 }, () => postJson<IIssueResultBody>(harness.baseUrl, '/issue', payload)),
    );

    const codes = new Set(results.map((r) => r.body.code));

    expect(codes.size).toBe(1);
    expect(results.filter((r) => r.body.replayed === false)).toHaveLength(1);
  });

  it('looks up a known request_id and 404s on an unknown one', async () => {
    const requestId = newRequestId();

    await postJson(harness.baseUrl, '/issue', { request_id: requestId, sku: 'KEY-EFT', order_id: 'order-4' });

    const known = await getJson<IIssueResultBody>(harness.baseUrl, `/issue/${requestId}`);

    expect(known.status).toBe(200);
    expect(known.body.code).toMatch(CODE_REGEX);

    const unknown = await getJson<IErrorBody>(harness.baseUrl, '/issue/does-not-exist');

    expect(unknown.status).toBe(404);
    expect(unknown.body.status).toBe('error');
    expect(unknown.body.reason).toBe('not_found');
  });

  it('responds ok after simulated latency in slow mode', async () => {
    await forceScenario(harness.baseUrl, SCENARIO_MODE.SLOW, 1);

    const started = Date.now();
    const result = await postJson<IIssueResultBody>(harness.baseUrl, '/issue', {
      request_id: newRequestId(),
      sku: 'KEY-EFT',
      order_id: 'order-5',
    });

    expect(Date.now() - started).toBeGreaterThanOrEqual(5);
    expect(result.status).toBe(200);
    expect(result.body.code).toMatch(CODE_REGEX);
  });

  it('never responds in timeout mode', async () => {
    await forceScenario(harness.baseUrl, SCENARIO_MODE.TIMEOUT, 1);

    await issueExpectNoResponse(harness.baseUrl, {
      request_id: newRequestId(),
      sku: 'KEY-EFT',
      order_id: 'order-6',
    });
  });

  it('mints and persists the record before hanging in issue_then_hang mode', async () => {
    await forceScenario(harness.baseUrl, SCENARIO_MODE.ISSUE_THEN_HANG, 1);

    const requestId = newRequestId();

    await issueExpectNoResponse(harness.baseUrl, { request_id: requestId, sku: 'KEY-EFT', order_id: 'order-7' });

    const stored = await getJson<IIssueResultBody>(harness.baseUrl, `/issue/${requestId}`);

    expect(stored.status).toBe(200);
    expect(stored.body.code).toMatch(CODE_REGEX);
  });

  it('returns 500 with a JSON error body in error_5xx mode', async () => {
    await forceScenario(harness.baseUrl, SCENARIO_MODE.ERROR_5XX, 1);

    const result = await postJson<IErrorBody>(harness.baseUrl, '/issue', {
      request_id: newRequestId(),
      sku: 'KEY-EFT',
      order_id: 'order-8',
    });

    expect(result.status).toBe(500);
    expect(result.body.status).toBe('error');
    expect(result.body.reason).toBe('upstream_unavailable');
  });

  it('returns 500 with a non-JSON garbage body in error_5xx_garbage mode', async () => {
    await forceScenario(harness.baseUrl, SCENARIO_MODE.ERROR_5XX_GARBAGE, 1);

    const result = await postRaw(harness.baseUrl, '/issue', {
      request_id: newRequestId(),
      sku: 'KEY-EFT',
      order_id: 'order-9',
    });

    expect(result.status).toBe(500);
    expect(() => JSON.parse(result.text)).toThrow();
  });

  it('returns 400 in bad_request mode', async () => {
    await forceScenario(harness.baseUrl, SCENARIO_MODE.BAD_REQUEST, 1);

    const result = await postJson<IErrorBody>(harness.baseUrl, '/issue', {
      request_id: newRequestId(),
      sku: 'KEY-EFT',
      order_id: 'order-10',
    });

    expect(result.status).toBe(400);
    expect(result.body.status).toBe('error');
    expect(result.body.reason).toBe('sku_unknown');
  });

  it('refuses the connection in refuse mode', async () => {
    await forceScenario(harness.baseUrl, SCENARIO_MODE.REFUSE, 1);

    await expect(
      fetch(`${harness.baseUrl}/issue`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ request_id: newRequestId(), sku: 'KEY-EFT', order_id: 'order-11' }),
      }),
    ).rejects.toBeTruthy();
  });

  it('returns 409 out_of_stock once depleted via restock(0)', async () => {
    await postJson(harness.baseUrl, '/_control/restock', { count: 0 });

    const result = await postJson<IErrorBody>(harness.baseUrl, '/issue', {
      request_id: newRequestId(),
      sku: 'KEY-EFT',
      order_id: 'order-12',
    });

    expect(result.status).toBe(409);
    expect(result.body.status).toBe('error');
    expect(result.body.reason).toBe('out_of_stock');
  });

  it('replays a known request_id even after depletion (precedence beats depletion)', async () => {
    const requestId = newRequestId();
    const payload = { request_id: requestId, sku: 'KEY-EFT', order_id: 'order-13' };

    const first = await postJson<IIssueResultBody>(harness.baseUrl, '/issue', payload);

    await postJson(harness.baseUrl, '/_control/restock', { count: 0 });

    const second = await postJson<IIssueResultBody>(harness.baseUrl, '/issue', payload);

    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.code).toBe(first.body.code);
  });
});

describe('supplier-stub persistence across restarts', () => {
  const persistPath = path.join(os.tmpdir(), `stub-state-persist-test-${randomUUID()}.json`);

  afterEach(() => {
    if (fs.existsSync(persistPath)) {
      fs.unlinkSync(persistPath);
    }
  });

  it('reloads a minted record after the process restarts', async () => {
    const requestId = newRequestId();
    const firstRun = await startStub({ ...TEST_ENV, STUB_PERSIST_PATH: persistPath });

    const minted = await postJson<IIssueResultBody>(firstRun.baseUrl, '/issue', {
      request_id: requestId,
      sku: 'KEY-EFT',
      order_id: 'order-persist',
    });

    await firstRun.stop();

    expect(minted.body.replayed).toBe(false);

    const secondRun = await startStub({ ...TEST_ENV, STUB_PERSIST_PATH: persistPath });

    const found = await getJson<IIssueResultBody>(secondRun.baseUrl, `/issue/${requestId}`);

    await secondRun.stop();

    expect(found.status).toBe(200);
    expect(found.body.code).toBe(minted.body.code);
  });
});
