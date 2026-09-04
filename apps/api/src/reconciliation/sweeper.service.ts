import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Interval, SchedulerRegistry } from '@nestjs/schedule';
import type { QueryRunner } from 'typeorm';

import { AppConfigService } from '../common/config/app-config.service';
import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import { DeliveryAttemptRepository } from '../delivery/delivery-attempt.repository';
import { JobQueueService } from '../jobs/job-queue.service';
import { JOB_KIND } from '../jobs/jobs.constants';
import type { IDeliverOrderPayload } from '../jobs/jobs.interfaces';
import { buildDeliverOrderDedupeKey } from '../jobs/jobs.util';
import { resolveTransition } from '../orders/order-state-machine';
import { ORDER_EVENT, TRANSITION_KIND } from '../orders/orders.constants';
import type { IRecoverableOrderRow } from '../orders/orders.interfaces';
import { OrdersRepository } from '../orders/orders.repository';
import { PaymentEventsRepository } from '../payments/payment-events.repository';
import { PaymentWebhookService } from '../payments/payment-webhook.service';
import { ORPHAN_ABANDONED_REASON, PAYMENT_EVENT_STATE } from '../payments/payments.constants';
import type { IPaymentEventInput } from '../payments/payments.interfaces';
import {
  SWEEPER_INFLIGHT_DEMOTED_REASON,
  SWEEPER_INTERVAL_NAME,
  SWEEPER_SHUTDOWN_DRAIN_TIMEOUT_MS,
  SWEEPER_TICK_INTERVAL_MS,
} from './sweeper.constants';
import type { ISweeperCycleResult } from './sweeper.interfaces';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

@Injectable()
export class SweeperService implements OnApplicationBootstrap, OnModuleDestroy {
  private running = false;

  // тот же смысл, что у JobWorkerService.inFlightTick: running защищает только от наложения
  // тика на тик, не от shutdown на тик — onModuleDestroy ждёт именно этот промис
  private inFlightTick: Promise<void> | null = null;

  constructor(
    private readonly config: AppConfigService,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly jobQueue: JobQueueService,
    private readonly orders: OrdersRepository,
    private readonly deliveryAttempts: DeliveryAttemptRepository,
    private readonly paymentEvents: PaymentEventsRepository,
    private readonly paymentWebhook: PaymentWebhookService,
    private readonly logger: AppLoggerService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.logger.setContext('SweeperService');
  }

  @Interval(SWEEPER_INTERVAL_NAME, SWEEPER_TICK_INTERVAL_MS)
  async tick(): Promise<void> {
    if (!this.config.sweeper.enabled || this.running) {
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
      // восстанавливаемый сбой: finally сбрасывает running, следующий тик повторит попытку
      this.logger.error(LOG_EVENT.SWEEPER_TICK_FAILED, err);
    }
  }

  async runOnce(): Promise<ISweeperCycleResult> {
    const result: ISweeperCycleResult = {
      reclaimedStaleJobs: await this.reclaimStaleJobs(),
      requeuedStuckOrders: await this.requeueStuckOrders(),
      retriedOutOfStock: await this.retryOutOfStock(),
      retriedDeliveryFailed: await this.retryDeliveryFailed(),
      demotedStaleInflight: await this.demoteStaleInflight(),
      redrivenUnknownAttempts: await this.redriveUnknownAttempts(),
      replayedOrphans: await this.replayOrphans(),
      abandonedOrphans: await this.abandonOrphans(),
    };

    this.logger.event(LOG_EVENT.SWEEPER_CYCLE, { ...result });

    return result;
  }

  // pass 1: джобы, зависшие в state='running' дольше config.jobs.lockTtlMs — тот же TTL,
  // что использует сам JobWorkerService
  private async reclaimStaleJobs(): Promise<number> {
    return this.unitOfWork.withTransaction((qr) => this.jobQueue.requeueStale(qr, this.config.jobs.lockTtlMs));
  }

  // pass 2: paid/delivering дольше stuckOrderAgeSeconds без issued_deliveries и без живой
  // deliver_order job — повторно ставит доставку в очередь, не трогая статус заказа
  private async requeueStuckOrders(): Promise<number> {
    const count = await this.unitOfWork.withTransaction(async (qr) => {
      const rows = await this.orders.findStuckPaidDelivering(
        qr,
        this.config.sweeper.stuckOrderAgeSeconds,
        this.config.sweeper.batchSize,
      );

      for (const row of rows) {
        await this.enqueueDeliverOrder(qr, row.id, row.ext_id, row.delivery_generation);
      }

      return rows.length;
    });

    if (count > 0) {
      this.logger.event(LOG_EVENT.SWEEPER_REQUEUED, { requeued_stuck_orders: count });
    }

    return count;
  }

  // pass 3: out_of_stock с восполненным остатком — немедленный повтор, без порога давности
  private async retryOutOfStock(): Promise<number> {
    return this.unitOfWork.withTransaction((qr) =>
      this.retryRecoverableOrders(qr, () =>
        this.orders.findRetryableOutOfStock(qr, this.config.sweeper.batchSize),
      ),
    );
  }

  // pass 4: delivery_failed старше deliveryFailedRetrySeconds, под потолком maxDeliveryGenerations
  private async retryDeliveryFailed(): Promise<number> {
    return this.unitOfWork.withTransaction((qr) =>
      this.retryRecoverableOrders(qr, () =>
        this.orders.findRetryableDeliveryFailed(
          qr,
          this.config.sweeper.deliveryFailedRetrySeconds,
          this.config.sweeper.maxDeliveryGenerations,
          this.config.sweeper.batchSize,
        ),
      ),
    );
  }

  private async retryRecoverableOrders(
    qr: QueryRunner,
    findRows: () => Promise<IRecoverableOrderRow[]>,
  ): Promise<number> {
    const rows = await findRows();
    let count = 0;

    for (const row of rows) {
      const rule = resolveTransition(row.status, ORDER_EVENT.RETRY_DELIVERY);

      if (rule.kind !== TRANSITION_KIND.APPLY) {
        continue;
      }

      const nextGeneration = row.delivery_generation + 1;
      const updated = await this.orders.transition(qr, row.id, row.status, rule.to, {
        deliveryGeneration: nextGeneration,
      });

      if (updated === null) {
        continue;
      }

      await this.enqueueDeliverOrder(qr, updated.id, updated.ext_id, updated.delivery_generation);
      count += 1;
    }

    return count;
  }

  // pass 5a: попытки, зависшие в in_flight дольше attemptInflightTimeoutMs, — воркер, скорее
  // всего, умер после TX-S1 коммита, не дождавшись ответа поставщика
  private async demoteStaleInflight(): Promise<number> {
    return this.unitOfWork.withTransaction(async (qr) => {
      const rows = await this.deliveryAttempts.demoteStaleInFlight(
        qr,
        this.config.sweeper.attemptInflightTimeoutMs,
        SWEEPER_INFLIGHT_DEMOTED_REASON,
        this.config.sweeper.batchSize,
      );

      return rows.length;
    });
  }

  // pass 5b: unknown-попытки, готовые к передозвону — нет отдельного resolve_unknown_attempt
  // обработчика (см. README §4.3), поэтому редрайв идёт через deliver_order: повторный
  // /issue с тем же request_id идемпотентен на стороне поставщика (RESUME_DELIVERY_ATTEMPT_SQL)
  private async redriveUnknownAttempts(): Promise<number> {
    return this.unitOfWork.withTransaction(async (qr) => {
      const rows = await this.deliveryAttempts.findResolvableUnknown(qr, this.config.sweeper.batchSize);

      for (const row of rows) {
        await this.enqueueDeliverOrder(qr, row.order_id, row.ext_id, row.delivery_generation);
      }

      return rows.length;
    });
  }

  // pass 6a: orphan-события, для которых заказ уже появился, — реплеятся через тот же
  // applyPersistedEvent, что и живой вебхук, в той же транзакции, что держит блокировку строки
  private async replayOrphans(): Promise<number> {
    const count = await this.unitOfWork.withTransaction(async (qr) => {
      const rows = await this.paymentEvents.findReplayableOrphans(qr, this.config.sweeper.batchSize);

      for (const row of rows) {
        const input: IPaymentEventInput = {
          eventId: row.event_id,
          orderExtId: row.order_ext_id,
          status: row.status,
          amountMinor: row.amount_minor,
          currency: row.currency,
          occurredAt: row.occurred_at,
          rawPayload: row.raw_payload,
          traceId: row.trace_id,
        };

        await this.paymentWebhook.applyPersistedEvent(qr, row.id, input);
      }

      return rows.length;
    });

    if (count > 0) {
      this.logger.event(LOG_EVENT.SWEEPER_REQUEUED, { replayed_orphans: count });
    }

    return count;
  }

  // pass 6b: orphan-события старше orphanTtlSeconds без заказа — заказ так и не появился, абандон
  private async abandonOrphans(): Promise<number> {
    const count = await this.unitOfWork.withTransaction(async (qr) => {
      const rows = await this.paymentEvents.findAbandonableOrphans(
        qr,
        this.config.sweeper.orphanTtlSeconds,
        this.config.sweeper.batchSize,
      );

      for (const row of rows) {
        await this.paymentEvents.finalise(qr, {
          id: row.id,
          state: PAYMENT_EVENT_STATE.ABANDONED,
          orderId: null,
          ignoreReason: ORPHAN_ABANDONED_REASON,
          appliedFromStatus: null,
          appliedToStatus: null,
        });
      }

      return rows.length;
    });

    if (count > 0) {
      this.logger.event(LOG_EVENT.SWEEPER_REQUEUED, { abandoned_orphans: count });
    }

    return count;
  }

  private async enqueueDeliverOrder(
    qr: QueryRunner,
    orderId: number,
    extId: string,
    generation: number,
  ): Promise<void> {
    const payload = { orderId, ext_id: extId, generation } satisfies IDeliverOrderPayload;

    await this.jobQueue.enqueue(qr, {
      kind: JOB_KIND.DELIVER_ORDER,
      dedupeKey: buildDeliverOrderDedupeKey(extId),
      payload,
      runAt: new Date(),
      traceId: null,
    });
  }

  // см. JobWorkerService.onApplicationBootstrap: тот же порядок регистрации/снятия интервала
  onApplicationBootstrap(): void {
    if (!this.config.sweeper.enabled) {
      if (this.schedulerRegistry.doesExist('interval', SWEEPER_INTERVAL_NAME)) {
        this.schedulerRegistry.deleteInterval(SWEEPER_INTERVAL_NAME);
      }

      return;
    }

    if (this.config.sweeper.intervalMs !== SWEEPER_TICK_INTERVAL_MS) {
      if (this.schedulerRegistry.doesExist('interval', SWEEPER_INTERVAL_NAME)) {
        this.schedulerRegistry.deleteInterval(SWEEPER_INTERVAL_NAME);
      }

      this.schedulerRegistry.addInterval(
        SWEEPER_INTERVAL_NAME,
        setInterval(() => void this.tick(), this.config.sweeper.intervalMs),
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      this.schedulerRegistry.deleteInterval(SWEEPER_INTERVAL_NAME);
    } catch {
      // интервал уже удалён (например, sweeper выключен) — не ошибка при остановке
    }

    if (this.inFlightTick === null) {
      return;
    }

    await Promise.race([this.inFlightTick, sleep(SWEEPER_SHUTDOWN_DRAIN_TIMEOUT_MS)]);
  }
}
