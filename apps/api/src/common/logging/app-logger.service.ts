import * as crypto from 'node:crypto';

import { Inject, Injectable, Scope } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';

import { CorrelationStore } from './correlation.store';
import { JSON_LOGGER, LOG_EVENT_LEVEL } from './logging.constants';
import type { ICorrelation } from './logging.interfaces';
import type { JsonLogger } from './json-logger';
import type { LogData, LogEventName, LogLevel } from './logging.type';

@Injectable({ scope: Scope.TRANSIENT })
export class AppLoggerService {
  private ctx: string;

  constructor(
    @Inject(JSON_LOGGER) private readonly logger: JsonLogger,
    private readonly store: CorrelationStore,
    @Inject(INQUIRER) inquirer: object | string,
  ) {
    this.ctx = this.resolveDefaultContext(inquirer);
  }

  setContext(ctx: string): void {
    this.ctx = ctx;
  }

  event(name: LogEventName, data?: LogData, level?: LogLevel): void {
    this.logger.write({
      level: level ?? LOG_EVENT_LEVEL[name],
      event: name,
      ctx: this.ctx,
      data,
    });
  }

  error(name: LogEventName, err: unknown, data?: LogData): void {
    this.logger.write({
      level: 'error',
      event: name,
      ctx: this.ctx,
      data,
      err,
    });
  }

  async withCorrelation<T>(patch: Partial<ICorrelation>, fn: () => Promise<T>): Promise<T> {
    const current = this.store.get();
    const traceId = patch.trace_id ?? current?.trace_id ?? crypto.randomUUID();

    return this.store.run({ ...current, ...patch, trace_id: traceId }, fn);
  }

  private resolveDefaultContext(inquirer: object | string): string {
    if (typeof inquirer === 'string') {
      return inquirer;
    }

    return inquirer?.constructor?.name ?? 'Application';
  }
}
