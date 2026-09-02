import * as fs from 'node:fs';

import { Injectable } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { StubLogger } from '../common/logging/stub-logger.service';
import { StubConfigService } from '../config/stub-config.service';
import { STUB_STATE_LOG_EVENT, STUB_STATE_VERSION } from './stub-state.constants';
import type { IIssueRecord, IStubState } from './stub-state.interfaces';

@Injectable()
export class StubStateStore implements OnModuleInit {
  private readonly persistPath: string | null;

  private readonly index = new Map<string, IIssueRecord>();

  private inventorySize: number;

  private consumed = 0;

  constructor(
    private readonly config: StubConfigService,
    private readonly logger: StubLogger,
  ) {
    const cfg = this.config.get();

    this.persistPath = cfg.persistPath;
    this.inventorySize = cfg.inventorySize;
  }

  onModuleInit(): void {
    if (this.persistPath === null || !fs.existsSync(this.persistPath)) {
      return;
    }

    try {
      const raw = fs.readFileSync(this.persistPath, 'utf8');
      const parsed = JSON.parse(raw) as IStubState;

      this.inventorySize = parsed.inventorySize;
      this.consumed = parsed.consumed;
      this.index.clear();

      for (const record of parsed.issued) {
        this.index.set(record.requestId, record);
      }

      this.logger.write({ level: 'info', event: STUB_STATE_LOG_EVENT.LOADED, data: { path: this.persistPath, issued: this.index.size } });
    } catch (err) {
      // Corrupt or unreadable state file must never crash the stub — start fresh.
      this.logger.write({ level: 'warn', event: STUB_STATE_LOG_EVENT.LOAD_FAILED, data: { path: this.persistPath }, err });
    }
  }

  findByRequestId(requestId: string): IIssueRecord | undefined {
    return this.index.get(requestId);
  }

  append(record: IIssueRecord): void {
    this.index.set(record.requestId, record);
    this.consumed += 1;
    this.persist();
  }

  remaining(): number {
    return Math.max(0, this.inventorySize - this.consumed);
  }

  // Sets the remaining count to exactly `count`, regardless of prior stock.
  restock(count: number): void {
    this.inventorySize = this.consumed + count;
    this.persist();
  }

  reset(): void {
    this.index.clear();
    this.consumed = 0;
    this.inventorySize = this.config.get().inventorySize;
    this.persist();
  }

  snapshot(): IStubState {
    return {
      version: STUB_STATE_VERSION,
      issued: Array.from(this.index.values()),
      consumed: this.consumed,
      inventorySize: this.inventorySize,
    };
  }

  private persist(): void {
    if (this.persistPath === null) {
      return;
    }

    fs.writeFileSync(this.persistPath, JSON.stringify(this.snapshot()));
  }
}
