import type { LogData, LogFormat, LogLevel, LogSink } from './logging.type';

export interface ICorrelation {
  trace_id: string;
  order_id?: string;
  event_id?: string;
  request_id?: string;
  job_id?: number;
}

export interface IErrorPayload {
  name: string;
  message: string;
  stack?: string;
}

export interface ILogRecordInput {
  level: LogLevel;
  event: string;
  ctx?: string;
  msg?: string;
  duration_ms?: number;
  data?: LogData;
  err?: unknown;
}

export interface ILogRecord {
  ts: string;
  level: LogLevel;
  event: string;
  ctx?: string;
  trace_id: string | null;
  order_id: string | null;
  event_id: string | null;
  request_id: string | null;
  job_id: number | null;
  duration_ms?: number;
  data?: LogData;
  err?: IErrorPayload;
  msg: string;
}

export interface IJsonLoggerOptions {
  level: LogLevel;
  format: LogFormat;
  includeStack: boolean;
  sink?: LogSink;
}

export interface IAccessLogFields {
  method: string;
  path: string;
  status: number;
}
