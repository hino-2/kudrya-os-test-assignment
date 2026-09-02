import { randomBytes } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  CODE_ALPHABET,
  CODE_GROUP_COUNT,
  CODE_GROUP_LENGTH,
  CODE_SEPARATOR,
  GARBAGE_BODY,
  STUB_ERROR_CODE,
} from '../config/stub-config.constants';
import { StubConfigService } from '../config/stub-config.service';
import { StubLogger } from '../common/logging/stub-logger.service';
import { randomInRange, sleep } from '../common/sleep.util';
import { ScenarioService } from '../scenario/scenario.service';
import { SCENARIO_MODE } from '../scenario/scenario.constants';
import type { IIssueRecord } from '../persistence/stub-state.interfaces';
import { StubStateStore } from '../persistence/stub-state.store';
import { ISSUE_HTTP_STATUS, ISSUE_LOG_EVENT } from './issue.constants';
import type { IssueRequestDto } from './dto/issue-request.dto';
import type { IIssueResult, IInventoryView } from './issue.interfaces';
import type { IssueDecision, IssueOutcome } from './issue.type';

@Injectable()
export class IssueService {
  private mutexTail: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly config: StubConfigService,
    private readonly scenario: ScenarioService,
    private readonly store: StubStateStore,
    private readonly logger: StubLogger,
  ) {}

  async issue(dto: IssueRequestDto): Promise<IssueOutcome> {
    const decision = await this.withMutex(() => this.decide(dto));

    return this.resolveOutcome(decision);
  }

  lookup(requestId: string): IIssueRecord | undefined {
    return this.store.findByRequestId(requestId);
  }

  inventory(): IInventoryView {
    const cfg = this.config.get();
    const snapshot = this.store.snapshot();

    return {
      supplierId: cfg.supplierId,
      total: snapshot.inventorySize,
      consumed: snapshot.consumed,
      remaining: this.store.remaining(),
    };
  }

  private withMutex<T>(fn: () => T): Promise<T> {
    const run = this.mutexTail.then(fn, fn);

    // Swallow rejection on the shared tail so one failed call never poisons the queue.
    this.mutexTail = run.catch(() => undefined);

    return run;
  }

  private decide(dto: IssueRequestDto): IssueDecision {
    const existing = this.store.findByRequestId(dto.request_id);

    if (existing) {
      return { kind: 'replayed', record: existing };
    }

    const mode = this.scenario.next();

    if (mode === SCENARIO_MODE.OUT_OF_STOCK || this.store.remaining() <= 0) {
      return { kind: 'blocked', mode: SCENARIO_MODE.OUT_OF_STOCK };
    }

    if (
      mode === SCENARIO_MODE.BAD_REQUEST ||
      mode === SCENARIO_MODE.ERROR_5XX ||
      mode === SCENARIO_MODE.ERROR_5XX_GARBAGE ||
      mode === SCENARIO_MODE.REFUSE ||
      mode === SCENARIO_MODE.TIMEOUT
    ) {
      return { kind: 'blocked', mode };
    }

    if (mode === SCENARIO_MODE.SLOW) {
      return { kind: 'minted', mode: 'slow', record: this.mint(dto) };
    }

    if (mode === SCENARIO_MODE.ISSUE_THEN_HANG) {
      return { kind: 'minted', mode: 'issue_then_hang', record: this.mint(dto) };
    }

    return { kind: 'minted', mode: 'ok', record: this.mint(dto) };
  }

  private async resolveOutcome(decision: IssueDecision): Promise<IssueOutcome> {
    if (decision.kind === 'replayed') {
      this.logger.write({
        level: 'info',
        event: ISSUE_LOG_EVENT.REPLAYED,
        data: { requestId: decision.record.requestId },
      });

      return {
        action: 'respond',
        status: ISSUE_HTTP_STATUS.OK,
        body: this.toResult(decision.record, true),
      };
    }

    if (decision.kind === 'minted') {
      this.logger.write({
        level: 'info',
        event: ISSUE_LOG_EVENT.MINTED,
        data: { requestId: decision.record.requestId, mode: decision.mode },
      });

      if (decision.mode === 'slow') {
        await sleep(randomInRange(this.config.get().latencyMinMs, this.config.get().latencyMaxMs));

        return {
          action: 'respond',
          status: ISSUE_HTTP_STATUS.OK,
          body: this.toResult(decision.record, false),
        };
      }

      if (decision.mode === 'issue_then_hang') {
        await sleep(this.config.get().hangMs);

        return { action: 'hang' };
      }

      return {
        action: 'respond',
        status: ISSUE_HTTP_STATUS.OK,
        body: this.toResult(decision.record, false),
      };
    }

    switch (decision.mode) {
      case SCENARIO_MODE.OUT_OF_STOCK:
        return {
          action: 'respond',
          status: ISSUE_HTTP_STATUS.OUT_OF_STOCK,
          body: { status: 'error', reason: STUB_ERROR_CODE.OUT_OF_STOCK },
        };
      case SCENARIO_MODE.BAD_REQUEST:
        return {
          action: 'respond',
          status: ISSUE_HTTP_STATUS.BAD_REQUEST,
          body: { status: 'error', reason: STUB_ERROR_CODE.BAD_REQUEST },
        };
      case SCENARIO_MODE.ERROR_5XX:
        return {
          action: 'respond',
          status: ISSUE_HTTP_STATUS.INTERNAL,
          body: { status: 'error', reason: STUB_ERROR_CODE.UPSTREAM_UNAVAILABLE },
        };
      case SCENARIO_MODE.ERROR_5XX_GARBAGE:
        return {
          action: 'respond_garbage',
          status: ISSUE_HTTP_STATUS.INTERNAL,
          body: GARBAGE_BODY,
        };
      case SCENARIO_MODE.REFUSE:
        return { action: 'refuse' };
      case SCENARIO_MODE.TIMEOUT:
        await sleep(this.config.get().hangMs);

        return { action: 'hang' };
      default:
        return { action: 'refuse' };
    }
  }

  private mint(dto: IssueRequestDto): IIssueRecord {
    const record: IIssueRecord = {
      requestId: dto.request_id,
      sku: dto.sku,
      orderId: dto.order_id,
      code: this.generateCode(),
      issuedAt: new Date().toISOString(),
    };

    this.store.append(record);

    return record;
  }

  private generateCode(): string {
    let code = this.drawCode();

    while (this.codeExists(code)) {
      code = this.drawCode();
    }

    return code;
  }

  private drawCode(): string {
    const groups: string[] = [];

    for (let g = 0; g < CODE_GROUP_COUNT; g += 1) {
      const bytes = randomBytes(CODE_GROUP_LENGTH);
      let group = '';

      for (let i = 0; i < CODE_GROUP_LENGTH; i += 1) {
        group += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
      }

      groups.push(group);
    }

    return groups.join(CODE_SEPARATOR);
  }

  private codeExists(code: string): boolean {
    return this.store.snapshot().issued.some((record) => record.code === code);
  }

  private toResult(record: IIssueRecord, replayed: boolean): IIssueResult {
    return {
      requestId: record.requestId,
      sku: record.sku,
      orderId: record.orderId,
      code: record.code,
      issuedAt: record.issuedAt,
      replayed,
    };
  }
}
