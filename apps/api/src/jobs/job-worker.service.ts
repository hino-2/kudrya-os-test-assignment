import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';

import { AppConfigService } from '../common/config/app-config.service';
import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import { JobHandlerRegistry } from './job-handler.registry';
import { JobQueueService } from './job-queue.service';
import {
  JOB_STATE,
  JOB_WORKER_INTERVAL_NAME,
  WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS,
  WORKER_TICK_INTERVAL_MS,
} from './jobs.constants';
import type { IJobRow, IWorkerCycleResult } from './jobs.interfaces';
import type { JobOutcome } from './jobs.type';
import { buildMissingHandlerMessage } from './jobs.util';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class JobWorkerService implements OnApplicationBootstrap, OnModuleDestroy {
  private running = false;

  // отслеживает тик, уже выполняющийся к моменту shutdown: running защищает только
  // от наложения тика на тик, а не shutdown на тик — без ожидания этого промиса onModuleDestroy
  // может продолжиться, пока тик ещё держит queryRunner, и DataSource закроется под ним
  private inFlightTick: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly queue: JobQueueService,
    private readonly registry: JobHandlerRegistry,
    private readonly logger: AppLoggerService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.logger.setContext('JobWorkerService');
  }

  @Interval(JOB_WORKER_INTERVAL_NAME, WORKER_TICK_INTERVAL_MS)
  async tick(): Promise<void> {
    if (!this.config.jobs.workerEnabled || this.running) {
      return;
    }

    this.running = true;

    const tickPromise = this.runTick();

    this.inFlightTick = tickPromise;

    try {
      await tickPromise;
    } finally {
      this.running = false;

      if (this.inFlightTick === tickPromise) {
        this.inFlightTick = null;
      }
    }
  }

  private async runTick(): Promise<void> {
    try {
      await this.runOnce();
    } catch (err) {
      // восстанавливаемый сбой: finally сбрасывает running, следующий тик повторит попытку —
      // это не смерть процесса, поэтому не app.uncaught_exception (main.ts шлёт этим событием process.exit(1))
      this.logger.error(LOG_EVENT.JOB_WORKER_TICK_FAILED, err);
    }
  }

  async runOnce(): Promise<IWorkerCycleResult> {
    // claim коммитится отдельной транзакцией до запуска обработчика: state='running' и attempts+1
    // должны быть видны другим воркерам и переживать падение обработчика
    const claimed = await this.unitOfWork.withTransaction((qr) =>
      this.queue.claim(qr, { workerId: this.config.jobs.workerId, limit: this.config.jobs.batchSize }),
    );
    const result: IWorkerCycleResult = { claimed: claimed.length, succeeded: 0, failed: 0, dead: 0 };

    for (const job of claimed) {
      await this.logger.withCorrelation({ trace_id: job.trace_id ?? undefined, job_id: job.id }, async () => {
        this.logger.event(LOG_EVENT.JOB_CLAIMED, { job_id: job.id, kind: job.kind, attempts: job.attempts });

        const outcome = await this.processJob(job);

        if (outcome === 'succeeded') {
          result.succeeded += 1;
        } else {
          result.failed += 1;

          if (job.attempts >= job.max_attempts) {
            result.dead += 1;
          }
        }
      });
    }

    return result;
  }

  // @Interval mounts the default interval in SchedulerOrchestrator.onApplicationBootstrap(),
  // which runs after every module's onModuleInit — so the registry lookups below (which assume
  // the default interval already exists) must live in onApplicationBootstrap too, not onModuleInit.
  // doesExist() guards every deleteInterval() call below so this branch does not depend on
  // ScheduleModule's onApplicationBootstrap having already run before JobsModule's (that ordering
  // is an implementation detail of Nest's module graph traversal, not a documented contract).
  onApplicationBootstrap(): void {
    if (!this.config.jobs.workerEnabled) {
      if (this.schedulerRegistry.doesExist('interval', JOB_WORKER_INTERVAL_NAME)) {
        this.schedulerRegistry.deleteInterval(JOB_WORKER_INTERVAL_NAME);
      }

      return;
    }

    if (this.config.jobs.pollIntervalMs !== WORKER_TICK_INTERVAL_MS) {
      if (this.schedulerRegistry.doesExist('interval', JOB_WORKER_INTERVAL_NAME)) {
        this.schedulerRegistry.deleteInterval(JOB_WORKER_INTERVAL_NAME);
      }

      this.schedulerRegistry.addInterval(
        JOB_WORKER_INTERVAL_NAME,
        setInterval(() => void this.tick(), this.config.jobs.pollIntervalMs),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.schedulerRegistry.deleteInterval(JOB_WORKER_INTERVAL_NAME);
    } catch {
      // интервал уже удалён (например, воркер выключен) — не ошибка при остановке
    }

    if (this.inFlightTick === null) {
      return;
    }

    // ограничено таймаутом: висящий тик не должен вешать shutdown навсегда,
    // но и закрывать DataSource у него из-под ног (QueryRunnerAlreadyReleasedError) тоже нельзя
    await Promise.race([this.inFlightTick, sleep(WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS)]);
  }

  private async processJob(job: IJobRow): Promise<JobOutcome> {
    const handler = this.registry.resolve(job.kind);

    try {
      if (handler === null) {
        throw new Error(buildMissingHandlerMessage(job.kind));
      }

      await handler.handle(job);
      await this.settle(job, null);

      return 'succeeded';
    } catch (error) {
      await this.settle(job, error);

      return 'failed';
    }
  }

  private async settle(job: IJobRow, error: unknown | null): Promise<void> {
    if (error === null) {
      await this.unitOfWork.withTransaction((qr) => this.queue.complete(qr, job.id));
      this.logger.event(LOG_EVENT.JOB_SUCCEEDED, { job_id: job.id, kind: job.kind });

      return;
    }

    const result = await this.unitOfWork.withTransaction((qr) =>
      this.queue.fail(qr, {
        id: job.id,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        error,
        backoff: { baseMs: this.config.jobs.retryBaseMs, maxMs: this.config.jobs.retryMaxMs },
      }),
    );

    if (result.state === JOB_STATE.DEAD) {
      this.logger.error(LOG_EVENT.JOB_DEAD, error, { job_id: job.id, kind: job.kind });
    } else {
      this.logger.event(LOG_EVENT.JOB_RETRY_SCHEDULED, {
        job_id: job.id,
        kind: job.kind,
        run_at: result.runAt,
        attempts: job.attempts,
      });
    }
  }
}
