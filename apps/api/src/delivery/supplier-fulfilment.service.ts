import { Injectable } from '@nestjs/common';
import type { QueryRunner } from 'typeorm';

import { FULFILLMENT_MODE } from '../catalog/catalog.constants';
import { AppConfigService } from '../common/config/app-config.service';
import { UnitOfWorkService } from '../common/db/unit-of-work.service';
import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { AppLoggerService } from '../common/logging/app-logger.service';
import { LOG_EVENT } from '../common/logging/logging.constants';
import { computeBackoffMs, computeNextRunAt } from '../jobs/backoff.util';
import { LEDGER_TXN_KIND } from '../ledger/ledger.constants';
import { LedgerService } from '../ledger/ledger.service';
import { buildBalancedLegs, buildDeliveryRecognizedKey } from '../ledger/ledger.util';
import { ORDER_STATUS } from '../orders/orders.constants';
import { OrdersRepository } from '../orders/orders.repository';
import { pickSupplier, resolveExhaustedOutcome, buildSupplierFailureReason } from '../suppliers/supplier-plan.util';
import { SupplierClient } from '../suppliers/supplier.client';
import { SUPPLIER_ERROR_KIND, SUPPLIER_MISSING_ERROR_KIND_MESSAGE, SUPPLIER_OUTCOME } from '../suppliers/suppliers.constants';
import type { ISupplierIssueResult } from '../suppliers/suppliers.interfaces';
import type { SupplierErrorKind } from '../suppliers/suppliers.type';
import { buildSupplierRequestId } from '../suppliers/suppliers.util';
import { DeliveryAttemptRepository } from './delivery-attempt.repository';
import { DeliveryRetryRequiredError } from './delivery-retry-required.error';
import {
  ATTEMPT_STATE,
  DELIVERY_ATTEMPT_LOST_MESSAGE,
  DELIVERY_OUT_OF_STOCK_REASON,
  DELIVERY_OUTCOME,
  ISSUED_DELIVERY_LOST_MESSAGE,
  SUPPLIER_ISSUED_WITHOUT_CODE_MESSAGE,
  SUPPLIER_JOB_BUDGET_EXCEEDED_MESSAGE,
} from './delivery.constants';
import { DeliveryRepository } from './delivery.repository';
import {
  buildDeliveryAttemptUnknownRetryMessage,
  buildOrderNotFoundMessage,
  buildSupplierJobLastAttemptMessage,
} from './delivery.util';
import type {
  IDeliveryAttemptRow,
  IDeliveryResult,
  IFulfilInput,
  IFulfilmentService,
  ILockedOrderRow,
} from './delivery.interfaces';
import type { PrepareStepResult, SettleStepResult } from './delivery.type';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// оркестрация выдачи через поставщика — split-транзакции TX-S1/HTTP/TX-S2 вокруг одного HTTP-вызова
// (см. PoolFulfilmentService.runTxP для однотранзакционного аналога пула)
@Injectable()
export class SupplierFulfilmentService implements IFulfilmentService {
  readonly mode = FULFILLMENT_MODE.SUPPLIER;

  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly deliveryRepository: DeliveryRepository,
    private readonly deliveryAttemptRepository: DeliveryAttemptRepository,
    private readonly supplierClient: SupplierClient,
    private readonly config: AppConfigService,
    private readonly ordersRepository: OrdersRepository,
    private readonly ledgerService: LedgerService,
    private readonly logger: AppLoggerService,
  ) {
    this.logger.setContext('SupplierFulfilmentService');
  }

  async fulfil(input: IFulfilInput): Promise<IDeliveryResult> {
    const deadline = Date.now() + this.config.supplier.jobBudgetMs;

    for (;;) {
      const prepared = await this.unitOfWork.withTransaction((qr) => this.prepareStep(qr, input));

      if (prepared.kind === 'terminal') {
        return prepared.result;
      }

      if (Date.now() >= deadline) {
        if (this.isLastAttempt(input)) {
          return this.forceDeliveryFailed(input, buildSupplierJobLastAttemptMessage(SUPPLIER_JOB_BUDGET_EXCEEDED_MESSAGE));
        }

        throw new DeliveryRetryRequiredError(SUPPLIER_JOB_BUDGET_EXCEEDED_MESSAGE, {
          baseMs: this.config.supplier.retryBaseMs,
          maxMs: this.config.supplier.retryMaxMs,
        });
      }

      const outcome = await this.supplierClient.issue({
        supplierCode: prepared.attempt.supplier_code,
        requestId: prepared.attempt.request_id,
        sku: prepared.attempt.sku,
        orderExtId: prepared.order.ext_id,
      });

      const settled = await this.unitOfWork.withTransaction((qr) => this.settleStep(qr, input, prepared.attempt, outcome));

      if (settled.kind === 'terminal') {
        return settled.result;
      }

      if (settled.kind === 'retry_required') {
        if (this.isLastAttempt(input)) {
          return this.forceDeliveryFailed(input, buildSupplierJobLastAttemptMessage(settled.message));
        }

        throw new DeliveryRetryRequiredError(settled.message, {
          baseMs: this.config.supplier.retryBaseMs,
          maxMs: this.config.supplier.retryMaxMs,
        });
      }

      if (settled.sleepMs !== null) {
        await sleep(settled.sleepMs);
      }
    }
  }

  // job.attempts достигает job.max_attempts на последней попытке воркера (см. job-worker.service.ts) —
  // без этой проверки джоба уходит в dead, а заказ остаётся в delivering навсегда
  private isLastAttempt(input: IFulfilInput): boolean {
    return input.attempts !== undefined && input.maxAttempts !== undefined && input.attempts >= input.maxAttempts;
  }

  // принудительное терминальное завершение на последней попытке джобы — отдельная транзакция,
  // т.к. вызывается вместо throw из середины fulfil(), без уже открытого QueryRunner
  private async forceDeliveryFailed(input: IFulfilInput, reason: string): Promise<IDeliveryResult> {
    return this.unitOfWork.withTransaction(async (qr) => {
      const order = await this.deliveryRepository.lockOrderForDelivery(qr, input.orderId);

      if (order === null) {
        throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND, buildOrderNotFoundMessage(input.orderId));
      }

      if (order.generation !== input.generation || order.status !== ORDER_STATUS.DELIVERING) {
        return { outcome: DELIVERY_OUTCOME.SKIPPED, code: null };
      }

      await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERY_FAILED, {
        failureReason: reason,
      });
      this.logger.event(LOG_EVENT.DELIVERY_FAILED, { order_id: order.id, reason });

      return { outcome: DELIVERY_OUTCOME.DELIVERY_FAILED, code: null };
    });
  }

  private async prepareStep(qr: QueryRunner, input: IFulfilInput): Promise<PrepareStepResult> {
    const order = await this.deliveryRepository.lockOrderForDelivery(qr, input.orderId);

    if (order === null) {
      throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND, buildOrderNotFoundMessage(input.orderId));
    }

    if (order.generation !== input.generation) {
      return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.SKIPPED, code: null } };
    }

    const idempotent = await this.handleTerminalStatus(qr, order);

    if (idempotent !== null) {
      return { kind: 'terminal', result: idempotent };
    }

    if (order.status !== ORDER_STATUS.PAID && order.status !== ORDER_STATUS.DELIVERING) {
      return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.SKIPPED, code: null } };
    }

    if (order.status === ORDER_STATUS.PAID) {
      this.logger.event(LOG_EVENT.DELIVERY_STARTED, { order_id: order.id, generation: order.generation });
      await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.PAID, ORDER_STATUS.DELIVERING, {});
    }

    const resumed = await this.resumeOrAbandonOpenAttempt(qr, order);

    if (resumed !== null) {
      return { kind: 'attempt', attempt: resumed, order };
    }

    return this.pickNextAttempt(qr, order);
  }

  // идемпотентные исходы для заказов, уже прошедших через доставку в предыдущей попытке
  private async handleTerminalStatus(qr: QueryRunner, order: ILockedOrderRow): Promise<IDeliveryResult | null> {
    if (order.status === ORDER_STATUS.DELIVERED) {
      const issued = await this.deliveryRepository.findIssuedDelivery(qr, order.id);

      return { outcome: DELIVERY_OUTCOME.ALREADY_DELIVERED, code: issued?.code ?? null };
    }

    if (order.status === ORDER_STATUS.OUT_OF_STOCK) {
      return { outcome: DELIVERY_OUTCOME.OUT_OF_STOCK, code: null };
    }

    return null;
  }

  // возобновляет уже открытую попытку (in_flight после сбоя воркера, unknown в ожидании дозвона);
  // при исчерпании бюджета дозвонов помечает её abandoned_unknown и возвращает null, чтобы
  // pickNextAttempt подобрал следующего поставщика в этом же прогоне джобы
  private async resumeOrAbandonOpenAttempt(qr: QueryRunner, order: ILockedOrderRow): Promise<IDeliveryAttemptRow | null> {
    const open = await this.deliveryAttemptRepository.findOpenAttempt(qr, order.id);

    if (open === null) {
      return null;
    }

    if (open.state === ATTEMPT_STATE.UNKNOWN && open.resolve_attempts >= this.config.supplier.unknownMaxResolveAttempts) {
      await this.deliveryAttemptRepository.markAbandoned(qr, open.id);
      this.logger.event(LOG_EVENT.DELIVERY_STRANDED_ISSUANCE, {
        order_id: order.id,
        supplier_code: open.supplier_code,
        request_id: open.request_id,
        reason: 'unknown_budget_exhausted',
      });

      return null;
    }

    const resumed = await this.deliveryAttemptRepository.resumeAttempt(qr, open.id);

    if (resumed === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, DELIVERY_ATTEMPT_LOST_MESSAGE);
    }

    this.logger.event(LOG_EVENT.DELIVERY_ATTEMPT_RESOLVING, {
      order_id: order.id,
      supplier_code: resumed.supplier_code,
      request_id: resumed.request_id,
      state: open.state,
    });

    return resumed;
  }

  private async pickNextAttempt(qr: QueryRunner, order: ILockedOrderRow): Promise<PrepareStepResult> {
    const attempts = await this.deliveryAttemptRepository.findAttemptsByOrder(qr, order.id);
    const choice = pickSupplier(attempts, this.config.supplier.maxAttemptsPerSupplier);

    if (choice === null) {
      return this.finalizeExhausted(qr, order, attempts);
    }

    const previousSupplier = attempts[attempts.length - 1]?.supplier_code ?? null;

    if (previousSupplier !== null && previousSupplier !== choice.supplierCode) {
      this.logger.event(LOG_EVENT.DELIVERY_FALLBACK, {
        order_id: order.id,
        from_supplier: previousSupplier,
        to_supplier: choice.supplierCode,
      });
    }

    const requestId = buildSupplierRequestId(order.ext_id, order.generation, choice.supplierCode, choice.attemptNo);
    const inserted = await this.deliveryAttemptRepository.insertAttempt(qr, {
      orderId: order.id,
      supplierCode: choice.supplierCode,
      attemptNo: choice.attemptNo,
      requestId,
      sku: order.sku,
    });
    // ON CONFLICT(order_id) DO NOTHING мог сработать из-за гонки — строка уже есть, перечитываем
    const attempt = inserted ?? (await this.deliveryAttemptRepository.findOpenAttempt(qr, order.id));

    if (attempt === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, DELIVERY_ATTEMPT_LOST_MESSAGE);
    }

    this.logger.event(LOG_EVENT.DELIVERY_ATTEMPT_CREATED, {
      order_id: order.id,
      supplier_code: attempt.supplier_code,
      attempt_no: attempt.attempt_no,
      request_id: attempt.request_id,
    });

    return { kind: 'attempt', attempt, order };
  }

  private async finalizeExhausted(qr: QueryRunner, order: ILockedOrderRow, attempts: IDeliveryAttemptRow[]): Promise<PrepareStepResult> {
    const exhaustedOutcome = resolveExhaustedOutcome(attempts);

    if (exhaustedOutcome === DELIVERY_OUTCOME.OUT_OF_STOCK) {
      await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.DELIVERING, ORDER_STATUS.OUT_OF_STOCK, {
        failureReason: DELIVERY_OUT_OF_STOCK_REASON,
      });
      this.logger.event(LOG_EVENT.DELIVERY_OUT_OF_STOCK, { order_id: order.id, generation: order.generation });

      return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.OUT_OF_STOCK, code: null } };
    }

    const reason = buildSupplierFailureReason(attempts);

    await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERY_FAILED, {
      failureReason: reason,
    });
    this.logger.event(LOG_EVENT.DELIVERY_FAILED, { order_id: order.id, reason });

    return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.DELIVERY_FAILED, code: null } };
  }

  private async settleStep(
    qr: QueryRunner,
    input: IFulfilInput,
    attempt: IDeliveryAttemptRow,
    outcome: ISupplierIssueResult,
  ): Promise<SettleStepResult> {
    const order = await this.deliveryRepository.lockOrderForDelivery(qr, input.orderId);

    if (order === null) {
      throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND, buildOrderNotFoundMessage(input.orderId));
    }

    const stale = order.generation !== input.generation;

    if (outcome.kind === SUPPLIER_OUTCOME.ISSUED) {
      return this.settleIssued(qr, order, attempt, outcome, stale);
    }

    if (outcome.kind === SUPPLIER_OUTCOME.UNKNOWN) {
      return this.settleUnknown(qr, order, attempt, outcome, stale);
    }

    // out_of_stock / rejected (4xx) / unavailable (connection_refused, 5xx) — определённая
    // неудача, продвигает attempt_no при следующем выборе поставщика
    const errorKind = this.requireErrorKind(outcome);

    await this.deliveryAttemptRepository.finalizeFailed(qr, {
      attemptId: attempt.id,
      httpStatus: outcome.httpStatus,
      errorKind,
      errorReason: outcome.errorReason,
      durationMs: outcome.durationMs,
    });

    if (stale) {
      return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.SKIPPED, code: null } };
    }

    // повтор того же поставщика допустим только при http_5xx (см. isRetriableSameSupplier) —
    // pickSupplier на следующей итерации сам решит, повторять того же поставщика или идти дальше
    const sleepMs =
      errorKind === SUPPLIER_ERROR_KIND.HTTP_5XX
        ? computeBackoffMs(attempt.attempt_no, { baseMs: this.config.supplier.retryBaseMs, maxMs: this.config.supplier.retryMaxMs })
        : null;

    return { kind: 'continue', sleepMs };
  }

  private async settleIssued(
    qr: QueryRunner,
    order: ILockedOrderRow,
    attempt: IDeliveryAttemptRow,
    outcome: ISupplierIssueResult,
    stale: boolean,
  ): Promise<SettleStepResult> {
    if (outcome.code === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, SUPPLIER_ISSUED_WITHOUT_CODE_MESSAGE);
    }

    await this.deliveryAttemptRepository.finalizeSucceeded(qr, {
      attemptId: attempt.id,
      httpStatus: outcome.httpStatus,
      responseCode: outcome.code,
      durationMs: outcome.durationMs,
    });

    if (stale) {
      // поставщик выдал код, но заказ уже ушёл в новое поколение — приложить код некуда;
      // полноценная сверка требует отдельного attempt-resolver'а, вне рамок этого этапа (см. README)
      this.logger.event(LOG_EVENT.DELIVERY_STRANDED_ISSUANCE, {
        order_id: order.id,
        supplier_code: attempt.supplier_code,
        request_id: attempt.request_id,
        reason: 'generation_advanced',
      });

      return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.SKIPPED, code: null } };
    }

    const existingIssued = await this.deliveryRepository.findIssuedDelivery(qr, order.id);
    let row = existingIssued;

    if (row === null) {
      const inserted = await this.deliveryRepository.insertSupplierIssuedDelivery(qr, {
        orderId: order.id,
        productId: order.product_id,
        sku: order.sku,
        code: outcome.code,
        supplierCode: attempt.supplier_code,
        deliveryAttemptId: attempt.id,
      });

      // ON CONFLICT(order_id) DO NOTHING мог сработать из-за гонки — строка уже есть, перечитываем
      row = inserted ?? (await this.deliveryRepository.findIssuedDelivery(qr, order.id));
    }

    if (row === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, ISSUED_DELIVERY_LOST_MESSAGE);
    }

    await this.ordersRepository.transition(qr, order.id, ORDER_STATUS.DELIVERING, ORDER_STATUS.DELIVERED, {
      deliveredAt: new Date(),
    });

    await this.ledgerService.postTxn(qr, {
      kind: LEDGER_TXN_KIND.DELIVERY_RECOGNIZED,
      idempotencyKey: buildDeliveryRecognizedKey(order.ext_id, order.generation),
      orderId: order.id,
      legs: buildBalancedLegs(LEDGER_TXN_KIND.DELIVERY_RECOGNIZED, order.amount_minor, order.currency, {
        orderId: order.id,
      }),
    });

    this.logger.event(LOG_EVENT.DELIVERY_ATTEMPT_SUCCEEDED, {
      order_id: order.id,
      supplier_code: attempt.supplier_code,
      request_id: attempt.request_id,
    });
    this.logger.event(LOG_EVENT.DELIVERY_COMPLETED, { order_id: order.id, generation: order.generation });

    return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.DELIVERED, code: row.code } };
  }

  private async settleUnknown(
    qr: QueryRunner,
    order: ILockedOrderRow,
    attempt: IDeliveryAttemptRow,
    outcome: ISupplierIssueResult,
    stale: boolean,
  ): Promise<SettleStepResult> {
    const errorKind = this.requireErrorKind(outcome);
    const nextResolveAt = computeNextRunAt(new Date(), attempt.resolve_attempts + 1, {
      baseMs: this.config.supplier.retryBaseMs,
      maxMs: this.config.supplier.retryMaxMs,
    });
    const resolveAttempts = await this.deliveryAttemptRepository.promoteToUnknown(qr, {
      attemptId: attempt.id,
      httpStatus: outcome.httpStatus,
      errorKind,
      errorReason: outcome.errorReason,
      nextResolveAt,
    });

    if (resolveAttempts === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, DELIVERY_ATTEMPT_LOST_MESSAGE);
    }

    this.logger.event(LOG_EVENT.DELIVERY_ATTEMPT_UNKNOWN, {
      order_id: order.id,
      supplier_code: attempt.supplier_code,
      request_id: attempt.request_id,
      error_kind: errorKind,
      resolve_attempts: resolveAttempts,
    });

    if (errorKind === SUPPLIER_ERROR_KIND.TIMEOUT) {
      this.logger.event(LOG_EVENT.DELIVERY_ATTEMPT_TIMEOUT, {
        order_id: order.id,
        supplier_code: attempt.supplier_code,
        request_id: attempt.request_id,
      });
    }

    if (stale) {
      return { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.SKIPPED, code: null } };
    }

    if (resolveAttempts >= this.config.supplier.unknownMaxResolveAttempts) {
      await this.deliveryAttemptRepository.markAbandoned(qr, attempt.id);
      this.logger.event(LOG_EVENT.DELIVERY_STRANDED_ISSUANCE, {
        order_id: order.id,
        supplier_code: attempt.supplier_code,
        request_id: attempt.request_id,
        reason: 'unknown_budget_exhausted',
      });

      return { kind: 'continue', sleepMs: null };
    }

    return { kind: 'retry_required', message: buildDeliveryAttemptUnknownRetryMessage(attempt.request_id) };
  }

  // errorKind контрактно не null во всех исходах кроме issued (см. classifySupplierHttpStatus /
  // classifySupplierNetworkError) — явная проверка вместо непроверяемого приведения типа
  private requireErrorKind(outcome: ISupplierIssueResult): SupplierErrorKind {
    if (outcome.errorKind === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, SUPPLIER_MISSING_ERROR_KIND_MESSAGE);
    }

    return outcome.errorKind;
  }
}
