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
  DELIVERY_ATTEMPT_RESOLVE_CONFLICT_MESSAGE,
  DELIVERY_LOOKUP_NOT_ISSUED_REASON,
  DELIVERY_OUT_OF_STOCK_REASON,
  DELIVERY_OUTCOME,
  ISSUED_DELIVERY_LOST_MESSAGE,
  SETTLE_VIA,
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
  IResumedOpenAttempt,
} from './delivery.interfaces';
import type { PrepareStepResult, SettleStepResult, SettleVia } from './delivery.type';

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
      // проверка бюджета обязана стоять ДО prepareStep: иначе TX-S1 успевает закоммитить строку
      // попытки и request_id, которые никуда не отправлялись, и она висит in_flight до демоции
      // свипером, съедая один дозвон за HTTP-вызов, которого не было
      if (Date.now() >= deadline) {
        if (this.isLastAttempt(input)) {
          return this.forceDeliveryFailed(input, buildSupplierJobLastAttemptMessage(SUPPLIER_JOB_BUDGET_EXCEEDED_MESSAGE));
        }

        throw new DeliveryRetryRequiredError(SUPPLIER_JOB_BUDGET_EXCEEDED_MESSAGE, {
          baseMs: this.config.supplier.retryBaseMs,
          maxMs: this.config.supplier.retryMaxMs,
        });
      }

      const prepared = await this.unitOfWork.withTransaction((qr) => this.prepareStep(qr, input));

      if (prepared.kind === 'terminal') {
        return prepared.result;
      }

      const via = prepared.kind === 'resolve' ? SETTLE_VIA.RESOLVE : SETTLE_VIA.ISSUE;
      // HTTP строго между двумя закоммиченными транзакциями (TX-S1 / HTTP / TX-S2): ни один
      // QueryRunner здесь не открыт — ровно поэтому отказ от неоднозначной попытки вынесен
      // из prepareStep в resolve-ветку settleStep
      const outcome =
        via === SETTLE_VIA.RESOLVE
          ? await this.supplierClient.lookup(prepared.attempt.supplier_code, prepared.attempt.request_id)
          : await this.supplierClient.issue({
              supplierCode: prepared.attempt.supplier_code,
              requestId: prepared.attempt.request_id,
              sku: prepared.attempt.sku,
              orderExtId: prepared.order.ext_id,
            });

      const settled = await this.unitOfWork.withTransaction((qr) =>
        this.settleStep(qr, input, prepared.attempt, outcome, via),
      );

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

    const resumed = await this.resumeOpenAttempt(qr, order);

    if (resumed !== null) {
      return resumed.needsLookup
        ? { kind: 'resolve', attempt: resumed.attempt, order }
        : { kind: 'attempt', attempt: resumed.attempt, order };
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

  // возобновляет уже открытую попытку (in_flight после сбоя воркера, unknown в ожидании дозвона).
  // needsLookup=true означает, что бюджет слепых POST-реплеев исчерпан и статус заявки надо
  // выяснить авторитетным GET /issue/:request_id. Попытка переводится в in_flight в обоих
  // случаях: без этого CAS finalizeSucceeded/finalizeFailed не совпадёт, а свипер (pass 5a)
  // мог бы демотировать её прямо во время вызова
  private async resumeOpenAttempt(qr: QueryRunner, order: ILockedOrderRow): Promise<IResumedOpenAttempt | null> {
    const open = await this.deliveryAttemptRepository.findOpenAttempt(qr, order.id);

    if (open === null) {
      return null;
    }

    const needsLookup =
      open.state === ATTEMPT_STATE.UNKNOWN &&
      open.resolve_attempts >= this.config.supplier.unknownMaxResolveAttempts;
    const resumed = await this.deliveryAttemptRepository.resumeAttempt(qr, open.id);

    if (resumed === null) {
      throw new DomainError(ERROR_CODE.INTERNAL_ERROR, DELIVERY_ATTEMPT_LOST_MESSAGE);
    }

    if (!needsLookup) {
      this.logger.event(LOG_EVENT.DELIVERY_ATTEMPT_RESOLVING, {
        order_id: order.id,
        supplier_code: resumed.supplier_code,
        request_id: resumed.request_id,
        state: open.state,
      });
    }

    return { attempt: resumed, needsLookup };
  }

  private async pickNextAttempt(qr: QueryRunner, order: ILockedOrderRow): Promise<PrepareStepResult> {
    const attempts = await this.deliveryAttemptRepository.findAttemptsByOrder(qr, order.id, order.generation);
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
      deliveryGeneration: order.generation,
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
    via: SettleVia,
  ): Promise<SettleStepResult> {
    const order = await this.deliveryRepository.lockOrderForDelivery(qr, input.orderId);

    if (order === null) {
      throw new DomainError(ERROR_CODE.ORDER_NOT_FOUND, buildOrderNotFoundMessage(input.orderId));
    }

    const stale = order.generation !== input.generation;

    if (outcome.kind === SUPPLIER_OUTCOME.ISSUED) {
      return this.settleIssued(qr, order, attempt, outcome, stale);
    }

    // resolve-шаг уже был последней инстанцией: promoteToUnknown здесь запрещён, иначе бюджет
    // дозвонов заново раздувается и цикл «слепой POST — дозвон» не завершается никогда
    if (via === SETTLE_VIA.RESOLVE) {
      return this.settleResolved(qr, order, attempt, outcome, stale);
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

    return { kind: 'continue', sleepMs: this.sameSupplierBackoffMs(attempt, errorKind) };
  }

  // повтор того же поставщика допустим только при http_5xx (см. isRetriableSameSupplier) —
  // pickSupplier на следующей итерации сам решит, повторять того же поставщика или идти дальше
  private sameSupplierBackoffMs(attempt: IDeliveryAttemptRow, errorKind: SupplierErrorKind): number | null {
    if (errorKind !== SUPPLIER_ERROR_KIND.HTTP_5XX) {
      return null;
    }

    return computeBackoffMs(attempt.attempt_no, {
      baseMs: this.config.supplier.retryBaseMs,
      maxMs: this.config.supplier.retryMaxMs,
    });
  }

  // исход авторитетного GET /issue/:request_id: либо поставщик сам отрицает заявку (404 —
  // определённая неудача), либо он не ответил и на чтение
  private async settleResolved(
    qr: QueryRunner,
    order: ILockedOrderRow,
    attempt: IDeliveryAttemptRow,
    outcome: ISupplierIssueResult,
    stale: boolean,
  ): Promise<SettleStepResult> {
    const skipped: SettleStepResult = { kind: 'terminal', result: { outcome: DELIVERY_OUTCOME.SKIPPED, code: null } };
    // проигранный CAS = строку увели (демоция свипером из in_flight в unknown, второй воркер).
    // Возвращать 'continue' здесь нельзя: needsLookup залипает (resolve_attempts только растёт),
    // и цикл ушёл бы в непрерывные GET без sleep до конца бюджета джобы. Повтор задачи, наоборот,
    // перечитает состояние под бэкоффом уровня джобы
    const conflict: SettleStepResult = { kind: 'retry_required', message: DELIVERY_ATTEMPT_RESOLVE_CONFLICT_MESSAGE };

    if (outcome.errorKind === SUPPLIER_ERROR_KIND.NOT_ISSUED) {
      // сохраняем ИСХОДНЫЙ error_kind попытки: именно по нему isRetriableSameSupplier решает,
      // повторять ли того же поставщика — подтверждённый «не выдавал» после http_5xx должен
      // вести себя ровно как определённый http_5xx, а не как новый вид неудачи
      const errorKind = attempt.error_kind ?? SUPPLIER_ERROR_KIND.NOT_ISSUED;
      const finalized = await this.deliveryAttemptRepository.finalizeFailed(qr, {
        attemptId: attempt.id,
        httpStatus: outcome.httpStatus,
        errorKind,
        errorReason: DELIVERY_LOOKUP_NOT_ISSUED_REASON,
        durationMs: outcome.durationMs,
      });

      if (!finalized) {
        return conflict;
      }

      this.logger.event(LOG_EVENT.DELIVERY_ATTEMPT_RESOLVED, {
        order_id: order.id,
        supplier_code: attempt.supplier_code,
        request_id: attempt.request_id,
        resolution: 'not_issued',
      });

      if (stale) {
        return skipped;
      }

      // тот же бэкофф, что и у определённой неудачи: pickSupplier на следующей итерации может
      // повторить того же поставщика по сохранённому http_5xx, и делать это мгновенно после
      // серии таймаутов и 404 бессмысленно
      return { kind: 'continue', sleepMs: this.sameSupplierBackoffMs(attempt, errorKind) };
    }

    // поставщик не ответил ни на бюджет слепых POST, ни на один авторитетный GET. Осознанный
    // остаточный риск: оставить оплаченный заказ навсегда недоставляемым хуже, чем громко
    // залогировать зависшую выдачу и отдать заказ следующему поставщику в этом же прогоне
    const abandoned = await this.deliveryAttemptRepository.markAbandoned(qr, attempt.id, attempt.started_at);

    if (!abandoned) {
      return conflict;
    }

    this.logger.event(LOG_EVENT.DELIVERY_STRANDED_ISSUANCE, {
      order_id: order.id,
      supplier_code: attempt.supplier_code,
      request_id: attempt.request_id,
      reason: 'unknown_unresolved_after_lookup',
    });

    return stale ? skipped : { kind: 'continue', sleepMs: null };
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

    // потолок unknownMaxResolveAttempts больше не означает «сдаться»: это переключатель со
    // слепого POST-реплея на авторитетный GET. Следующий прогон джобы войдёт в resolve-путь
    // (см. resumeOpenAttempt) — отказ принимает только он
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
