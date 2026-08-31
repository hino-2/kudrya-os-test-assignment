import type { LoggerService, LogLevel as NestLogLevel } from '@nestjs/common';

import type { CorrelationStore } from './correlation.store';
import { LOG_LEVEL_SEVERITY, NEST_FRAMEWORK_EVENT, NEST_LEVEL_MAP, NEST_STACK_PATTERN } from './logging.constants';
import type { IErrorPayload, IJsonLoggerOptions, ILogRecord, ILogRecordInput } from './logging.interfaces';
import type { LogLevel } from './logging.type';

const PRETTY_TRACE_ID_LENGTH = 8;

export class JsonLogger implements LoggerService {
  private minSeverity: number;

  constructor(
    private readonly options: IJsonLoggerOptions,
    private readonly correlation?: CorrelationStore,
  ) {
    this.minSeverity = LOG_LEVEL_SEVERITY[options.level];
  }

  isEnabled(level: LogLevel): boolean {
    return LOG_LEVEL_SEVERITY[level] >= this.minSeverity;
  }

  write(input: ILogRecordInput): void {
    if (!this.isEnabled(input.level)) {
      return;
    }

    const correlation = this.correlation?.get();
    const record: ILogRecord = {
      ts: new Date().toISOString(),
      level: input.level,
      event: input.event,
      ctx: input.ctx,
      trace_id: correlation?.trace_id ?? null,
      order_id: correlation?.order_id ?? null,
      event_id: correlation?.event_id ?? null,
      request_id: correlation?.request_id ?? null,
      job_id: correlation?.job_id ?? null,
      duration_ms: input.duration_ms,
      data: input.data,
      msg: input.msg ?? input.event,
    };

    if ((input.level === 'warn' || input.level === 'error') && input.err !== undefined) {
      record.err = this.toErrorPayload(input.err);
    }

    this.emit(record);
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestRecord('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestRecord('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestRecord('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestRecord('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestRecord('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.writeNestRecord('fatal', message, optionalParams);
  }

  setLogLevels(levels: NestLogLevel[]): void {
    const severities = levels.map((level) => LOG_LEVEL_SEVERITY[NEST_LEVEL_MAP[level] ?? 'info']);

    if (severities.length > 0) {
      this.minSeverity = Math.min(...severities);
    }
  }

  private writeNestRecord(nestLevel: string, message: unknown, optionalParams: unknown[]): void {
    const level = NEST_LEVEL_MAP[nestLevel] ?? 'info';
    const last = optionalParams.length > 0 ? optionalParams[optionalParams.length - 1] : undefined;
    const lastIsStack = typeof last === 'string' && NEST_STACK_PATTERN.test(last);
    const ctx = last !== undefined && !lastIsStack ? String(last) : undefined;

    this.write({
      level,
      event: NEST_FRAMEWORK_EVENT,
      ctx,
      msg: String(message),
      err: level === 'error' ? this.resolveNestError(message, lastIsStack ? (last as string) : undefined) : undefined,
    });
  }

  private resolveNestError(message: unknown, stack: string | undefined): unknown {
    if (stack === undefined) {
      return message;
    }

    if (message instanceof Error) {
      message.stack ??= stack;

      return message;
    }

    const error = new Error(String(message));

    error.stack = stack;

    return error;
  }

  private toErrorPayload(err: unknown): IErrorPayload {
    if (err instanceof Error) {
      return {
        name: err.name,
        message: err.message,
        stack: this.options.includeStack ? err.stack : undefined,
      };
    }

    return { name: 'UnknownError', message: String(err) };
  }

  private emit(record: ILogRecord): void {
    const sink = this.options.sink ?? ((line: string) => process.stdout.write(line));

    try {
      const line = this.options.format === 'pretty' ? this.formatPretty(record) : this.safeStringify(record);

      sink(`${line}\n`);
    } catch {
      const fallback = JSON.stringify({
        ts: record.ts,
        level: 'error',
        event: 'app.log_serialize_failed',
        trace_id: record.trace_id,
        msg: record.msg,
      });

      sink(`${fallback}\n`);
    }
  }

  private safeStringify(record: ILogRecord): string {
    const toErrorPayload = (err: unknown): IErrorPayload => this.toErrorPayload(err);
    const ancestors: unknown[] = [];

    return JSON.stringify(record, function replacer(this: unknown, _key, value: unknown) {
      if (typeof value === 'bigint') {
        return value.toString();
      }

      if (value instanceof Error) {
        return toErrorPayload(value);
      }

      if (typeof value !== 'object' || value === null) {
        return value;
      }

      while (ancestors.length > 0 && ancestors[ancestors.length - 1] !== this) {
        ancestors.pop();
      }

      if (ancestors.includes(value)) {
        return undefined;
      }

      ancestors.push(value);

      return value;
    });
  }

  private formatPretty(record: ILogRecord): string {
    const time = record.ts.slice(11, 23);
    const ctxPart = record.ctx ? `[${record.ctx}] ` : '';
    const traceId = record.trace_id ? record.trace_id.slice(0, PRETTY_TRACE_ID_LENGTH) : 'none';
    const parts = [`${time} ${record.level.toUpperCase()} ${ctxPart}${record.event} trace=${traceId}`];

    if (record.duration_ms !== undefined) {
      parts.push(`duration_ms=${record.duration_ms}`);
    }

    if (record.data !== undefined) {
      for (const [key, value] of Object.entries(record.data)) {
        parts.push(`${key}=${JSON.stringify(value)}`);
      }
    }

    if (record.err !== undefined) {
      parts.push(`err=${record.err.name}:${record.err.message}`);
    }

    return parts.join(' ');
  }
}
