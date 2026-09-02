import { Injectable } from '@nestjs/common';

import { StubConfigService } from '../../config/stub-config.service';
import { LOG_LEVEL_SEVERITY } from './logging.constants';
import type { IErrorPayload, ILogRecord, ILogRecordInput } from './logging.interfaces';
import type { LogFormat, LogLevel } from './logging.type';

@Injectable()
export class StubLogger {
  private readonly minSeverity: number;

  private readonly supplierId: string;

  private readonly format: LogFormat;

  constructor(config: StubConfigService) {
    const cfg = config.get();

    this.minSeverity = LOG_LEVEL_SEVERITY[cfg.logLevel as LogLevel];
    this.supplierId = cfg.supplierId;
    this.format = cfg.logFormat as LogFormat;
  }

  write(input: ILogRecordInput): void {
    if (LOG_LEVEL_SEVERITY[input.level] < this.minSeverity) {
      return;
    }

    const record: ILogRecord = {
      ts: new Date().toISOString(),
      level: input.level,
      event: input.event,
      supplier_id: this.supplierId,
      data: input.data,
      err: input.err !== undefined ? this.toErrorPayload(input.err) : undefined,
    };

    const line = this.format === 'pretty' ? this.formatPretty(record) : JSON.stringify(record);

    process.stdout.write(`${line}\n`);
  }

  private toErrorPayload(err: unknown): IErrorPayload {
    if (err instanceof Error) {
      return { name: err.name, message: err.message };
    }

    return { name: 'UnknownError', message: String(err) };
  }

  private formatPretty(record: ILogRecord): string {
    const time = record.ts.slice(11, 23);
    const parts = [`${time} ${record.level.toUpperCase()} [${record.supplier_id}] ${record.event}`];

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
