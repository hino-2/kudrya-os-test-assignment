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
import { WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS } from '../../src/jobs/jobs.constants';
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

  return new JobWorkerService(buildConfig(), unitOfWork, queue, registry, buildLogger(), schedulerRegistry);
}

describe('JobWorkerService onModuleDestroy draining an in-flight tick', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not resolve until the in-flight tick settles', async () => {
    const deferred = buildDeferredClaim();
    const service = buildService(() => deferred.promise);

    const tickPromise = service.tick();
    let destroyed = false;
    const destroyPromise = service.onModuleDestroy().then(() => {
      destroyed = true;
    });

    await Promise.resolve();
    await Promise.resolve();
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
