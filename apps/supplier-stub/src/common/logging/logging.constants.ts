import type { LogLevel } from './logging.type';

export const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const DEFAULT_LOG_LEVEL: LogLevel = 'info';

const DEFAULT_LOG_FORMAT = 'json';

export { DEFAULT_LOG_LEVEL, DEFAULT_LOG_FORMAT };
