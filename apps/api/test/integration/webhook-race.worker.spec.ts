import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ORDER_STATUS } from '../../src/orders/orders.constants';
import type { CreateOrderResponseDto } from '../../src/orders/dto/create-order.response.dto';
import type { PaymentWebhookResponseDto } from '../../src/payments/dto/payment-webhook.response.dto';
import { ATTEMPT_STATE } from '../../src/delivery/delivery.constants';
import { SUPPLIER_CODE } from '../../src/suppliers/suppliers.constants';
import { startApi } from '../helpers/app.harness';
import { startStub } from '../helpers/stub.harness';
import { TEST_WORKER_SUPPLIER_A_PORT, TEST_WORKER_SUPPLIER_B_PORT } from '../helpers/harness.constants';
import type { IApiHarness, IStubHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';
import { seedCatalog } from '../helpers/seed.helper';
import { buildDeliverOrderDedupeKey } from '../../src/jobs/jobs.util';
import { buildRaceEvents, expectedRequestId, fireRace, resetStub, summariseResults, waitForDelivered } from '../helpers/race.helper';
import {
  CASH_DEBIT_SUMMARY_BY_ORDER_ID_SQL,
  COUNT_APPLIED_PAYMENT_EVENTS_SQL,
  COUNT_DELIVER_ORDER_JOBS_SQL,
  COUNT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL,
  COUNT_ISSUED_DELIVERIES_BY_ORDER_ID_SQL,
  COUNT_LEDGER_ENTRIES_BY_ORDER_ID_SQL,
  COUNT_LEDGER_TXNS_BY_ORDER_ID_SQL,
  COUNT_PAYMENT_EVENTS_BY_ORDER_SQL,
  COUNT_STOCK_KEYS_BY_ORDER_ID_SQL,
  COUNT_UNBALANCED_LEDGER_TXNS_SQL,
  POOL_RACE_SKU,
  POOL_RACE_SKU_AMOUNT_MAJOR,
  RACE_EVENT_COUNT,
  RACE_ITERATIONS,
  SELECT_AVAILABLE_COUNT_BY_SKU_SQL,
  SELECT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL,
  SELECT_ORDER_ID_BY_EXT_ID_SQL,
  SELECT_ORDER_STATUS_BY_EXT_ID_SQL,
  SUM_SIGNED_MINOR_GLOBAL_SQL,
  SUPPLIER_RACE_SKU,
  SUPPLIER_RACE_SKU_AMOUNT_MAJOR,
} from '../helpers/race.constants';

interface IHttpResult<T> {
  status: number;
  body: T;
}

interface IOrderRow {
  status: string;
}

interface IOrderIdRow {
  id: number;
}

interface ICountRow {
  count: number;
}

interface ISumRow {
  count: number;
  sum: number;
}

interface IAvailableCountRow {
  available_count: number;
}

interface IDeliveryAttemptRow {
  supplier_code: string;
  attempt_no: number;
  state: string;
  request_id: string;
}

const MINOR_UNITS_PER_MAJOR = 100;

let api: IApiHarness;

let stubA: IStubHarness;

let stubB: IStubHarness;

async function post<T>(baseUrl: string, path: string, payload: unknown): Promise<IHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

async function createOrder(sku: string): Promise<string> {
  const { body } = await post<CreateOrderResponseDto>(api.baseUrl, '/orders', { sku });

  return body.order_id;
}

async function fetchOrderStatus(extId: string): Promise<string> {
  const rows = await api.dataSource.query<IOrderRow[]>(SELECT_ORDER_STATUS_BY_EXT_ID_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row.status;
}

async function fetchOrderId(extId: string): Promise<number> {
  const rows = await api.dataSource.query<IOrderIdRow[]>(SELECT_ORDER_ID_BY_EXT_ID_SQL, [extId]);
  const row = rows[0];

  if (row === undefined) {
    throw new Error(`Заказ ${extId} не найден в базе`);
  }

  return row.id;
}

async function countOne(sql: string, params: unknown[]): Promise<number> {
  const rows = await api.dataSource.query<ICountRow[]>(sql, params);

  return rows[0]?.count ?? 0;
}

// весь сценарий гонки в одну функцию: 50 параллельных вебхуков на один заказ, дожидание
// доставки фоновой job, набор проверок из §11.1 test-plan, общих для обоих режимов fulfilment
async function runRaceIteration(extId: string, amountMajor: number): Promise<void> {
  const events = buildRaceEvents(extId, amountMajor, RACE_EVENT_COUNT, Date.now());
  const results = await fireRace<PaymentWebhookResponseDto>(api.baseUrl, events);

  // 1. все 50 запросов получают HTTP 200 — сервер никогда не роняет конкурентный вебхук ошибкой
  for (const result of results) {
    expect(result.status).toBe(200);
  }

  // 2. ровно один результат 'applied', остальные 49 разложены между ignored_already_paid и
  // ignored_stale — точное соотношение недетерминировано (зависит от порядка захвата FOR UPDATE),
  // поэтому эти два исхода никогда не проверяются по отдельности, только applied===1 и сумма
  const summary = summariseResults(results);

  expect(summary.applied).toBe(1);
  expect(summary.other).toBe(0);
  expect(summary.ignoredAlreadyPaid + summary.ignoredStale).toBe(RACE_EVENT_COUNT - 1);

  // 3. все 50 событий персистированы в payment_events (аудиторский след), ровно одно — applied
  expect(await countOne(COUNT_PAYMENT_EVENTS_BY_ORDER_SQL, [extId])).toBe(RACE_EVENT_COUNT);
  expect(await countOne(COUNT_APPLIED_PAYMENT_EVENTS_SQL, [extId])).toBe(1);

  // 4. заказ переведён в paid ровно один раз — идемпотентность применения событий транслируется
  // в единственную попытку доставки, а не в 50
  const job = await waitForDelivered(api.dataSource, extId);

  expect(job.attempts).toBe(1);

  // 5. ровно одна deliver_order job поставлена в очередь (dedupe_key не даёт задублировать)
  expect(await countOne(COUNT_DELIVER_ORDER_JOBS_SQL, [buildDeliverOrderDedupeKey(extId)])).toBe(1);

  // 6. заказ доставлен
  expect(await fetchOrderStatus(extId)).toBe(ORDER_STATUS.DELIVERED);

  const orderId = await fetchOrderId(extId);

  // 7. ровно одна запись issued_deliveries — товар выдан один раз, а не 50
  expect(await countOne(COUNT_ISSUED_DELIVERIES_BY_ORDER_ID_SQL, [orderId])).toBe(1);

  // 9. леджер сбалансирован: ровно 2 проводки (payment_captured + delivery_recognized), 4 записи,
  // ни одной несбалансированной транзакции глобально, cash дебетован ровно один раз на сумму заказа
  expect(await countOne(COUNT_LEDGER_TXNS_BY_ORDER_ID_SQL, [orderId])).toBe(2);
  expect(await countOne(COUNT_LEDGER_ENTRIES_BY_ORDER_ID_SQL, [orderId])).toBe(4);
  expect(await countOne(COUNT_UNBALANCED_LEDGER_TXNS_SQL, [])).toBe(0);

  const sumRows = await api.dataSource.query<ISumRow[]>(SUM_SIGNED_MINOR_GLOBAL_SQL, []);

  expect(sumRows[0]?.sum ?? -1).toBe(0);

  const cashDebitRows = await api.dataSource.query<ISumRow[]>(CASH_DEBIT_SUMMARY_BY_ORDER_ID_SQL, [orderId]);
  const cashDebit = cashDebitRows[0];

  expect(cashDebit?.count).toBe(1);
  expect(cashDebit?.sum).toBe(amountMajor * MINOR_UNITS_PER_MAJOR);
}

beforeAll(async () => {
  const stubEnvBase = {
    STUB_FAIL_RATE: '0',
    STUB_TIMEOUT_RATE: '0',
    STUB_SLOW_RATE: '0',
    STUB_PERSIST_PATH: '',
  };

  // фиксированные порты: WORKER_ENABLED=true, SUPPLIER_A_BASE_URL/SUPPLIER_B_BASE_URL и
  // SUPPLIER_REQUEST_TIMEOUT_MS форсированы в env.setup.worker-enabled.ts ДО импорта AppModule
  stubA = await startStub({ ...stubEnvBase, SUPPLIER_ID: 'A' }, TEST_WORKER_SUPPLIER_A_PORT);
  stubB = await startStub({ ...stubEnvBase, SUPPLIER_ID: 'B' }, TEST_WORKER_SUPPLIER_B_PORT);

  api = await startApi();
});

afterAll(async () => {
  await api?.stop();
  await stubA?.stop();
  await stubB?.stop();
});

beforeEach(async () => {
  await resetDatabase(api.dataSource);
  await seedCatalog(api.dataSource);
  await resetStub(stubA);
  await resetStub(stubB);
});

describe('webhook race: supplier fulfilment mode (STEAM-TOPUP-500)', () => {
  it.each(Array.from({ length: RACE_ITERATIONS }, (_, index) => index + 1))(
    'fires 50 concurrent webhooks for the same order and delivers exactly once — iteration %i',
    async () => {
      const extId = await createOrder(SUPPLIER_RACE_SKU);

      await runRaceIteration(extId, SUPPLIER_RACE_SKU_AMOUNT_MAJOR);

      const orderId = await fetchOrderId(extId);

      // 7 (уточнение для supplier-режима). ровно одна попытка доставки, поставщик A, attempt_no=1
      expect(await countOne(COUNT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL, [orderId])).toBe(1);

      const attempts = await api.dataSource.query<IDeliveryAttemptRow[]>(SELECT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL, [orderId]);
      const requestId = expectedRequestId(extId);

      expect(attempts).toHaveLength(1);
      expect(attempts[0]).toMatchObject({
        supplier_code: SUPPLIER_CODE.A,
        attempt_no: 1,
        state: ATTEMPT_STATE.SUCCEEDED,
        request_id: requestId,
      });

      // 8. поставщик A выдал ровно один код на ожидаемый request_id — не 50 отдельных выдач
      const lookupResponse = await fetch(`${stubA.baseUrl}/issue/${requestId}`);
      const lookupBody = (await lookupResponse.json()) as { status: string; request_id: string };

      expect(lookupResponse.status).toBe(200);
      expect(lookupBody).toMatchObject({ status: 'ok', request_id: requestId });
    },
  );
});

describe('webhook race: pool fulfilment mode (KEY-CS2-PRIME)', () => {
  it.each(Array.from({ length: RACE_ITERATIONS }, (_, index) => index + 1))(
    'fires 50 concurrent webhooks for the same order and delivers exactly one key — iteration %i',
    async () => {
      const availableBeforeRows = await api.dataSource.query<IAvailableCountRow[]>(SELECT_AVAILABLE_COUNT_BY_SKU_SQL, [
        POOL_RACE_SKU,
      ]);
      const availableBefore = availableBeforeRows[0]?.available_count ?? -1;

      const extId = await createOrder(POOL_RACE_SKU);

      await runRaceIteration(extId, POOL_RACE_SKU_AMOUNT_MAJOR);

      const orderId = await fetchOrderId(extId);

      // 10. ровно один ключ пула закреплён за заказом, доступный остаток уменьшился ровно на 1
      expect(await countOne(COUNT_STOCK_KEYS_BY_ORDER_ID_SQL, [orderId])).toBe(1);

      const availableAfterRows = await api.dataSource.query<IAvailableCountRow[]>(SELECT_AVAILABLE_COUNT_BY_SKU_SQL, [
        POOL_RACE_SKU,
      ]);
      const availableAfter = availableAfterRows[0]?.available_count ?? -1;

      expect(availableAfter).toBe(availableBefore - 1);

      // pool-режим никогда не пишет delivery_attempts (см. PoolFulfilmentService.runTxP)
      expect(await countOne(COUNT_DELIVERY_ATTEMPTS_BY_ORDER_ID_SQL, [orderId])).toBe(0);
    },
  );
});
