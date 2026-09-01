import { BACKOFF_MAX_EXPONENT, BACKOFF_MIN_MS } from './jobs.constants';
import type { IBackoffOptions } from './jobs.interfaces';

export function computeBackoffMs(attempt: number, options: IBackoffOptions): number {
  const safeAttempt = Math.max(1, Math.trunc(attempt));
  const exponent = Math.min(safeAttempt - 1, BACKOFF_MAX_EXPONENT);
  const raw = options.baseMs * 2 ** exponent;
  const capped = Math.min(raw, options.maxMs);
  const random = options.random ?? Math.random;
  const jittered = capped / 2 + random() * (capped / 2);

  return Math.min(options.maxMs, Math.max(BACKOFF_MIN_MS, Math.round(jittered)));
}

export function computeNextRunAt(now: Date, attempt: number, options: IBackoffOptions): Date {
  return new Date(now.getTime() + computeBackoffMs(attempt, options));
}
