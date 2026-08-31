import type { LOG_EVENT } from './logging.constants';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFormat = 'json' | 'pretty';

export type LogEventName = (typeof LOG_EVENT)[keyof typeof LOG_EVENT];

export type LogData = Readonly<Record<string, unknown>>;

export type LogSink = (line: string) => void;
