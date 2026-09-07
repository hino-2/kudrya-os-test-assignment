import type { SchedulerRegistry } from '@nestjs/schedule';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppConfigService } from '../../src/common/config/app-config.service';
import { UnitOfWorkService } from '../../src/common/db/unit-of-work.service';
import { AppLoggerService } from '../../src/common/logging/app-logger.service';
import { CorrelationStore } from '../../src/common/logging/correlation.store';
import { JsonLogger } from '../../src/common/logging/json-logger';
import { JobHandlerRegistry } from '../../src/jobs/job-handler.registry';
import { JobQueueService } from '../../src/jobs/job-queue.service';
import { JobWorkerService } from '../../src/jobs/job-worker.service';
import {
  JOB_KIND,
  JOB_STATE,
  WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS,
} from '../../src/jobs/jobs.constants';
import { LOG_EVENT } from '../../src/common/logging/logging.constants';
import type { IJobRow } from '../../src/jobs/jobs.interfaces';

interface IDeferredClaim {
  promise: Promise<IJobRow[]>;
  resolve: (rows: IJobRow[]) => void;
}

function buildDeferredClaim(): IDeferredClaim {
  let resolve!: (rows: IJobRow[]) => void;

  const promise = new Promise<IJobRow[]>((res) => {
    resolve = res;
  });

  return { promise, resolve };
}

function buildLogger(): AppLoggerService {
  return new AppLoggerService(
    new JsonLogger({ level: 'error', format: 'json', includeStack: false, sink: () => {} }),
    new CorrelationStore(),
    'JobWorkerService',
  );
}

function buildConfig(): AppConfigService {
  return {
    jobs: {
      workerEnabled: true,
      workerId: 'test-worker',
      pollIntervalMs: 200,
      batchSize: 10,
      maxAttempts: 5,
      retryBaseMs: 500,
      retryMaxMs: 30000,
      lockTtlMs: 60000,
    },
  } as unknown as AppConfigService;
}

// вместо реального UnitOfWorkService подсовываем withTransaction, разрешение которого
// полностью в руках теста — это и есть точка контроля над "висящим" тиком
function buildService(claim: () => Promise<IJobRow[]>): JobWorkerService {
  const unitOfWork = { withTransaction: claim } as unknown as UnitOfWorkService;
  const queue = {} as unknown as JobQueueService;
  const registry = {} as unknown as JobHandlerRegistry;
  const schedulerRegistry = { deleteInterval: vi.fn() } as unknown as SchedulerRegistry;

  return new JobWorkerService(
    buildConfig(),
    unitOfWork,
    queue,
    registry,
    buildLogger(),
    schedulerRegistry,
  );
}

describe('JobWorkerService onModuleDestroy draining an in-flight tick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not resolve until the in-flight tick settles', async () => {
    vi.useFakeTimers();

    const deferred = buildDeferredClaim();
    const service = buildService(() => deferred.promise);

    const tickPromise = service.tick();
    let destroyed = false;
    const destroyPromise = service.onModuleDestroy().then(() => {
      destroyed = true;
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(destroyed).toBe(false);

    deferred.resolve([]);
    await destroyPromise;

    expect(destroyed).toBe(true);
    await tickPromise;
  });

  it('resolves once WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS elapses even if the tick never settles', async () => {
    vi.useFakeTimers();

    const deferred = buildDeferredClaim();
    const service = buildService(() => deferred.promise);

    const tickPromise = service.tick();
    let destroyed = false;
    const destroyPromise = service.onModuleDestroy().then(() => {
      destroyed = true;
    });

    await vi.advanceTimersByTimeAsync(WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS - 1);
    expect(destroyed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await destroyPromise;

    expect(destroyed).toBe(true);

    deferred.resolve([]);
    await tickPromise;
  });
});

// H8: без ветки !applied воркер логировал бы job.succeeded для чужой строки и засорял
// dead-letter сигнал падениями по джобе, которую уже исполняет другой воркер. Ветки живут
// в самом воркере, поэтому SQL-предикат их не покрывает — нужен отдельный тест.
describe('JobWorkerService settle when the job was claimed away', () => {
  function buildJob(): IJobRow {
    return {
      id: 1,
      kind: JOB_KIND.DELIVER_ORDER,
      dedupe_key: 'ownership:unit',
      payload: { orderId: 1, ext_id: 'ord_1', generation: 0 },
      state: JOB_STATE.RUNNING,
      attempts: 1,
      max_attempts: 5,
      run_at: new Date(),
      locked_at: new Date(),
      locked_by: 'other-worker',
      last_error: null,
      trace_id: null,
      created_at: new Date(),
      updated_at: new Date(),
      finished_at: null,
    };
  }

  function buildWorker(
    queueOverrides: Partial<JobQueueService>,
    events: string[],
  ): JobWorkerService {
    const job = buildJob();
    const queue = {
      requeueStale: () => Promise.resolve(0),
      claim: () => Promise.resolve([job]),
      ...queueOverrides,
    } as unknown as JobQueueService;
    const unitOfWork = {
      withTransaction: (cb: (qr: unknown) => unknown) => Promise.resolve(cb({})),
    } as unknown as UnitOfWorkService;
    const registry = {
      resolve: () => ({ kind: JOB_KIND.DELIVER_ORDER, handle: () => Promise.resolve() }),
    } as unknown as JobHandlerRegistry;
    const schedulerRegistry = { deleteInterval: vi.fn() } as unknown as SchedulerRegistry;
    const logger = new AppLoggerService(
      new JsonLogger({
        level: 'debug',
        format: 'json',
        includeStack: false,
        sink: (line: string) => {
          events.push((JSON.parse(line) as { event: string }).event);
        },
      }),
      new CorrelationStore(),
      'JobWorkerService',
    );

    return new JobWorkerService(
      buildConfig(),
      unitOfWork,
      queue,
      registry,
      logger,
      schedulerRegistry,
    );
  }

  it('logs job.ownership_lost instead of job.succeeded when complete matches no row', async () => {
    const events: string[] = [];
    const worker = buildWorker({ complete: () => Promise.resolve(false) }, events);

    const result = await worker.runOnce();

    expect(events).toContain(LOG_EVENT.JOB_OWNERSHIP_LOST);
    expect(events).not.toContain(LOG_EVENT.JOB_SUCCEEDED);
    // обработчик отработал успешно — потеряна только строка учёта
    expect(result.succeeded).toBe(1);
  });

  it('logs job.succeeded when complete matches the owned row', async () => {
    const events: string[] = [];
    const worker = buildWorker({ complete: () => Promise.resolve(true) }, events);

    await worker.runOnce();

    expect(events).toContain(LOG_EVENT.JOB_SUCCEEDED);
    expect(events).not.toContain(LOG_EVENT.JOB_OWNERSHIP_LOST);
  });
});
