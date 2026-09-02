import type { LogLevel } from './logging.type';

export interface IErrorPayload {
  name: string;
  message: string;
}

export interface ILogRecordInput {
  level: LogLevel;
  event: string;
  data?: Record<string, unknown>;
  err?: unknown;
}

export interface ILogRecord {
  ts: string;
  level: LogLevel;
  event: string;
  supplier_id: string;
  data?: Record<string, unknown>;
  err?: IErrorPayload;
}
