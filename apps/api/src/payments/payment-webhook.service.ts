import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { CorrelationStore } from '../common/logging/correlation.store';
import { LOG_EVENT } from '../common/logging/logging.constants';
import { toMinor } from '../common/money/money.util';
import { JOB_KIND } from '../jobs/jobs.constants';
import type { IDeliverOrderPayload } from '../jobs/jobs.interfaces';
import { buildDeliverOrderDedupeKey } from '../jobs/jobs.util';
import { JobQueueService } from '../jobs/job-queue.service';
import { LEDGER_TXN_KIND } from '../ledger/ledger.constants';
import { LedgerService } from '../ledger/ledger.service';
import { buildBalancedLegs, buildPaymentCapturedKey } from '../ledger/ledger.util';
import { TRANSITION_KIND } from '../orders/orders.constants';
import { resolveTransition } from '../orders/order-state-machine';
import type { IOrderRow } from '../orders/orders.interfaces';
import { OrdersRepository } from '../orders/orders.repository';
import type { OrderEvent, OrderStatus } from '../orders/orders.type';
import {
  PAYMENT_EVENT_STATE,
  PAYMENT_FAILED_REASON,
  PAYMENT_STATUS,
  PAYMENT_TRANSITION_LOST_MESSAGE,
  WEBHOOK_RESULT,
  WEBHOOK_RESULT_LOG_EVENT,
} from './payments.constants';
import type { IPaymentEventInput, IWebhookOutcome } from './payments.interfaces';
import { PaymentEventsRepository } from './payment-events.repository';
import {
  buildAmountMismatchReason,
  buildConflictReason,
  buildIgnoredReason,
  buildStaleReason,
  resolveIgnoredState,
  toOrderEvent,
} from './payments.util';
import type { PaymentWebhookRequestDto } from './dto/payment-webhook.request.dto';
import type { RawWebhookPayload } from './payments.type';

@Injectable()
export class PaymentWebhookService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly paymentEvents: PaymentEventsRepository,
    private readonly orders: OrdersRepository,
    private readonly ledger: LedgerService,
    private readonly jobQueue: JobQueueService,
    private readonly correlationStore: CorrelationStore,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('PaymentWebhookService');
  }

  async handle(dto: PaymentWebhookRequestDto, rawPayload: RawWebhookPayload): Promise<IWebhookOutcome> {
    this.logger.event(LOG_EVENT.PAYMENT_RECEIVED, {
      order_id: dto.order_id,
      status: dto.status,
      amount: dto.amount,
    });

    const input: IPaymentEventInput = {
      eventId: dto.event_id,
      orderExtId: dto.order_id,
      status: dto.status,
      amountMinor: toMinor(dto.amount, 'amount'),
      currency: dto.currency,
      occurredAt: new Date(dto.created_at),
      rawPayload,
      traceId: this.correlationStore.traceId(),
    };

    const outcome = await this.unitOfWork.withTransaction((qr) => this.applyEventInTransaction(qr, input));

    const logEvent = WEBHOOK_RESULT_LOG_EVENT[outcome.result];
    const logData = {
      result: outcome.result,
      order_id: input.orderExtId,
      event_id: outcome.eventId,
    };

    if (outcome.result === WEBHOOK_RESULT.CONFLICT || outcome.result === WEBHOOK_RESULT.REJECTED_AMOUNT) {
      this.logger.error(logEvent, undefined, logData);
    } else {
      this.logger.event(logEvent, logData);
    }

    if (outcome.jobId !== null) {
      this.logger.event(LOG_EVENT.DELIVERY_ENQUEUED, {
        job_id: outcome.jobId,
        order_id: input.orderExtId,
      });
    }

    return outcome;
  }

  async applyEventInTransaction(qr: QueryRunner, input: IPaymentEventInput): Promise<IWebhookOutcome> {
    const eventId = await this.paymentEvents.insertPending(qr, input);

    if (eventId === null) {
      return {
        result: WEBHOOK_RESULT.DUPLICATE,
        orderStatus: null,
        eventId: input.eventId,
        paymentEventId: null,
        jobId: null,
      };
    }

    return this.applyPersistedEvent(qr, eventId, input);
  }

  async applyPersistedEvent(qr: QueryRunner, eventId: number, input: IPaymentEventInput): Promise<IWebhookOutcome> {
    const order = await this.orders.lockForUpdate(qr, input.orderExtId);

    if (order === null) {
      await this.paymentEvents.finalise(qr, {
        id: eventId,
        state: PAYMENT_EVENT_STATE.ORPHAN,
        orderId: null,
        ignoreReason: null,
        appliedFromStatus: null,
        appliedToStatus: null,
      });

      return {
        result: WEBHOOK_RESULT.ORPHAN,
        orderStatus: null,
        eventId: input.eventId,
        paymentEventId: eventId,
        jobId: null,
      };
    }

    const amountRejection = await this.guardAmount(qr, eventId, input, order);

    if (amountRejection !== null) {
      return amountRejection;
    }

    const staleRejection = await this.guardStaleness(qr, eventId, input, order);

    if (staleRejection !== null) {
      return staleRejection;
    }

    const event = toOrderEvent(input.status);
    const rule = resolveTransition(order.status, event);

    if (rule.kind === TRANSITION_KIND.APPLY) {
      return this.applyTransition(qr, eventId, input, order, rule.to);
    }

    if (rule.kind === TRANSITION_KIND.NOOP) {
      return this.finaliseIgnored(qr, eventId, input, order, event);
    }

    await this.paymentEvents.finalise(qr, {
      id: eventId,
      state: PAYMENT_EVENT_STATE.CONFLICT,
      orderId: order.id,
      ignoreReason: buildConflictReason(order.status, event),
      appliedFromStatus: order.status,
      appliedToStatus: null,
    });

    return {
      result: WEBHOOK_RESULT.CONFLICT,
      orderStatus: order.status,
      eventId: input.eventId,
      paymentEventId: eventId,
      jobId: null,
    };
  }

  private async guardAmount(
    qr: QueryRunner,
    eventId: number,
    input: IPaymentEventInput,
    order: IOrderRow,
  ): Promise<IWebhookOutcome | null> {
    if (input.status !== PAYMENT_STATUS.PAID) {
      return null;
    }

    if (input.amountMinor === order.total_minor && input.currency === order.currency) {
      return null;
    }

    await this.paymentEvents.finalise(qr, {
      id: eventId,
      state: PAYMENT_EVENT_STATE.REJECTED_AMOUNT,
      orderId: order.id,
      ignoreReason: buildAmountMismatchReason(order.total_minor, order.currency, input.amountMinor, input.currency),
      appliedFromStatus: order.status,
      appliedToStatus: null,
    });

    return {
      result: WEBHOOK_RESULT.REJECTED_AMOUNT,
      orderStatus: order.status,
      eventId: input.eventId,
      paymentEventId: eventId,
      jobId: null,
    };
  }

  private async guardStaleness(
    qr: QueryRunner,
    eventId: number,
    input: IPaymentEventInput,
    order: IOrderRow,
  ): Promise<IWebhookOutcome | null> {
    if (order.last_payment_event_at === null || input.occurredAt >= order.last_payment_event_at) {
      return null;
    }

    await this.paymentEvents.finalise(qr, {
      id: eventId,
      state: PAYMENT_EVENT_STATE.IGNORED_STALE,
      orderId: order.id,
      ignoreReason: buildStaleReason(input.occurredAt, order.last_payment_event_at),
      appliedFromStatus: order.status,
      appliedToStatus: null,
    });

    return {
      result: WEBHOOK_RESULT.IGNORED_STALE,
      orderStatus: order.status,
      eventId: input.eventId,
      paymentEventId: eventId,
      jobId: null,
    };
  }

  private async finaliseIgnored(
    qr: QueryRunner,
    eventId: number,
    input: IPaymentEventInput,
    order: IOrderRow,
    event: OrderEvent,
  ): Promise<IWebhookOutcome> {
    const state = resolveIgnoredState(event);
    const result = state === PAYMENT_EVENT_STATE.IGNORED_ALREADY_PAID
      ? WEBHOOK_RESULT.IGNORED_ALREADY_PAID
      : WEBHOOK_RESULT.IGNORED_TERMINAL;

    await this.paymentEvents.finalise(qr, {
      id: eventId,
      state,
      orderId: order.id,
      ignoreReason: buildIgnoredReason(order.status, event),
      appliedFromStatus: order.status,
      appliedToStatus: null,
    });

    return {
      result,
      orderStatus: order.status,
      eventId: input.eventId,
      paymentEventId: eventId,
      jobId: null,
    };
  }

  private async applyTransition(
    qr: QueryRunner,
    eventId: number,
    input: IPaymentEventInput,
    order: IOrderRow,
    to: OrderStatus,
  ): Promise<IWebhookOutcome> {
    const isPaid = input.status === PAYMENT_STATUS.PAID;
    const updated = await this.orders.transition(qr, order.id, order.status, to, {
      paidAt: isPaid ? input.occurredAt : undefined,
      failureReason: isPaid ? undefined : PAYMENT_FAILED_REASON,
      lastPaymentEventId: input.eventId,
      lastPaymentEventAt: input.occurredAt,
    });

    if (updated === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, PAYMENT_TRANSITION_LOST_MESSAGE, {
        order_id: order.ext_id,
      });
    }

    let jobId: number | null = null;

    if (isPaid) {
      await this.ledger.postTxn(qr, {
        kind: LEDGER_TXN_KIND.PAYMENT_CAPTURED,
        idempotencyKey: buildPaymentCapturedKey(input.eventId),
        orderId: order.id,
        legs: buildBalancedLegs(LEDGER_TXN_KIND.PAYMENT_CAPTURED, order.total_minor, order.currency, {
          orderId: order.id,
          paymentEventId: eventId,
        }),
      });

      const payload = {
        orderId: order.id,
        ext_id: order.ext_id,
        generation: updated.delivery_generation,
      } satisfies IDeliverOrderPayload;

      jobId = await this.jobQueue.enqueue(qr, {
        kind: JOB_KIND.DELIVER_ORDER,
        dedupeKey: buildDeliverOrderDedupeKey(order.ext_id),
        payload,
        runAt: new Date(),
        traceId: input.traceId,
      });
    }

    await this.paymentEvents.finalise(qr, {
      id: eventId,
      state: PAYMENT_EVENT_STATE.APPLIED,
      orderId: order.id,
      ignoreReason: null,
      appliedFromStatus: order.status,
      appliedToStatus: updated.status,
    });

    return {
      result: WEBHOOK_RESULT.APPLIED,
      orderStatus: updated.status,
      eventId: input.eventId,
      paymentEventId: eventId,
      jobId,
    };
  }
}
