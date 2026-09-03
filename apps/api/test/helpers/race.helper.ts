import type { DataSource } from 'typeorm';

import type { IControlStateResponse } from '@store/supplier-stub/src/control/control.interfaces';
import { JOB_STATE } from '../../src/jobs/jobs.constants';
import { buildDeliverOrderDedupeKey } from '../../src/jobs/jobs.util';
import type { IJobRow } from '../../src/jobs/jobs.interfaces';
import { buildSupplierRequestId } from '../../src/suppliers/suppliers.util';
import { SUPPLIER_CODE } from '../../src/suppliers/suppliers.constants';
import type { IStubHarness } from './harness.interfaces';
import { waitFor } from './wait-for';
import {
  CONTROL_RESET_PATH,
  CONTROL_SCENARIO_PATH,
  CONTROL_STATE_PATH,
  RACE_CURRENCY,
  RACE_EVENT_ID_PREFIX,
  RACE_FIRST_SUPPLIER_ATTEMPT_NO,
  RACE_INITIAL_DELIVERY_GENERATION,
  RACE_JITTER_MAX_MS,
  RACE_PAYMENT_STATUS,
  RACE_PRNG_SEED,
  RACE_WAIT_FOR_DELIVERED_TIMEOUT_MS,
  SELECT_JOB_BY_DEDUPE_KEY_SQL,
  WEBHOOK_PAYMENT_PATH,
} from './race.constants';
import type { IRaceHttpResult, IRacePayload, IRaceSummary } from './race.interfaces';

// mulberry32: маленький детерминированный PRNG — тестам нужна воспроизводимая (не Math.random)
// последовательность разброса created_at, одна и та же при каждом прогоне с тем же seed
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

// count событий с одинаковым order_id, но уникальными event_id — имитация 50 параллельных
// доставок одного и того же вебхука платёжной системы. created_at разбросан детерминированным
// PRNG вокруг baseCreatedAtMs, чтобы часть событий гарантированно оказалась "раньше" того,
// что реально применится первым (и получила ignored_stale), без завязки на Math.random
export function buildRaceEvents(
  extId: string,
  amountMajor: number,
  count: number,
  baseCreatedAtMs: number,
): IRacePayload[] {
  const next = createPrng(RACE_PRNG_SEED);
  const events: IRacePayload[] = [];

  for (let i = 0; i < count; i += 1) {
    const jitterMs = Math.round(next() * RACE_JITTER_MAX_MS - RACE_JITTER_MAX_MS / 2);

    events.push({
      event_id: `${RACE_EVENT_ID_PREFIX}${extId}_${i}`,
      order_id: extId,
      status: RACE_PAYMENT_STATUS,
      amount: amountMajor,
      currency: RACE_CURRENCY,
      created_at: new Date(baseCreatedAtMs + jitterMs).toISOString(),
    });
  }

  return events;
}

async function post<T>(baseUrl: string, path: string, payload: unknown): Promise<IRaceHttpResult<T>> {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as T;

  return { status: response.status, body };
}

// все запросы стартуют без ожидания друг друга (Promise.all) — это и есть гонка: сервер должен
// сериализовать конкурентный доступ к одному order_id сам (FOR UPDATE), а не полагаться на клиента
export function fireRace<T>(apiBaseUrl: string, events: IRacePayload[]): Promise<IRaceHttpResult<T>[]> {
  return Promise.all(events.map((event) => post<T>(apiBaseUrl, WEBHOOK_PAYMENT_PATH, event)));
}

export function summariseResults(results: IRaceHttpResult<{ result: string }>[]): IRaceSummary {
  const summary: IRaceSummary = {
    total: results.length,
    applied: 0,
    ignoredAlreadyPaid: 0,
    ignoredStale: 0,
    other: 0,
  };

  for (const { body } of results) {
    switch (body.result) {
      case 'applied':
        summary.applied += 1;
        break;
      case 'ignored_already_paid':
        summary.ignoredAlreadyPaid += 1;
        break;
      case 'ignored_stale':
        summary.ignoredStale += 1;
        break;
      default:
        summary.other += 1;
    }
  }

  return summary;
}

// синхронизация по завершению фоновой job — по наблюдаемому поведению воркера (см.
// deliver-order.handler.ts/job-worker.service.ts) обновление статуса заказа коммитится строго
// до перехода задачи в JOB_STATE.DONE, поэтому опрос jobs — безопасная и нефлейкающая точка
// синхронизации (тот же приём используют supplier-delivery.worker.spec.ts/pool-delivery.worker.spec.ts)
export async function waitForDelivered(dataSource: DataSource, extId: string): Promise<IJobRow> {
  const dedupeKey = buildDeliverOrderDedupeKey(extId);

  const job = await waitFor<IJobRow | undefined>(
    async () => {
      const rows = await dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);

      return rows[0];
    },
    (candidate) => candidate !== undefined && candidate.state === JOB_STATE.DONE,
    {
      timeoutMs: RACE_WAIT_FOR_DELIVERED_TIMEOUT_MS,
      message: `Задача доставки для заказа ${extId} не перешла в done за отведённое время`,
    },
  );

  if (job === undefined) {
    throw new Error(`Задача доставки для заказа ${extId} не найдена`);
  }

  return job;
}

// первая (и в сценариях этого спека единственная) попытка доставки всегда идёт с исходным
// delivery_generation=0 (см. миграцию InitCore, DEFAULT 0) на поставщике A, attempt_no=1
export function expectedRequestId(extId: string): string {
  return buildSupplierRequestId(extId, RACE_INITIAL_DELIVERY_GENERATION, SUPPLIER_CODE.A, RACE_FIRST_SUPPLIER_ATTEMPT_NO);
}

export async function readStubState(stub: IStubHarness): Promise<IControlStateResponse> {
  const response = await fetch(`${stub.baseUrl}${CONTROL_STATE_PATH}`);

  return (await response.json()) as IControlStateResponse;
}

export async function forceStubScenario(stub: IStubHarness, mode: string, times = 1): Promise<void> {
  await post(stub.baseUrl, CONTROL_SCENARIO_PATH, { mode, times });
}

export async function resetStub(stub: IStubHarness): Promise<void> {
  await post(stub.baseUrl, CONTROL_RESET_PATH, {});
}
