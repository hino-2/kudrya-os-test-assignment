import { describe, expect, it } from 'vitest';

import { computeBackoffMs, computeNextRunAt } from '../../src/jobs/backoff.util';
import { BACKOFF_MIN_MS } from '../../src/jobs/jobs.constants';
import type { IBackoffOptions } from '../../src/jobs/jobs.interfaces';

const BASE_MS = 500;

const MAX_MS = 30000;

function options(random: () => number, overrides: Partial<IBackoffOptions> = {}): IBackoffOptions {
  return { baseMs: BASE_MS, maxMs: MAX_MS, random, ...overrides };
}

function lowerEdge(attempt: number, baseMs: number, maxMs: number): number {
  const exponent = attempt - 1;
  const capped = Math.min(baseMs * 2 ** exponent, maxMs);

  return Math.max(BACKOFF_MIN_MS, Math.round(capped / 2));
}

describe('computeBackoffMs', () => {
  it('returns the exact lower edge for attempt=1 with random=0', () => {
    const result = computeBackoffMs(1, options(() => 0));

    expect(result).toBeGreaterThanOrEqual(BACKOFF_MIN_MS);
    expect(result).toBe(lowerEdge(1, BASE_MS, MAX_MS));
  });

  it('stays within [BACKOFF_MIN_MS, maxMs] for attempts 1..15 at random extremes', () => {
    for (let attempt = 1; attempt <= 15; attempt++) {
      const low = computeBackoffMs(attempt, options(() => 0));
      const high = computeBackoffMs(attempt, options(() => 0.9999));

      expect(low).toBeGreaterThanOrEqual(BACKOFF_MIN_MS);
      expect(low).toBeLessThanOrEqual(MAX_MS);
      expect(high).toBeGreaterThanOrEqual(BACKOFF_MIN_MS);
      expect(high).toBeLessThanOrEqual(MAX_MS);
    }
  });

  it('grows monotonically non-decreasing across attempts with fixed random', () => {
    const random = () => 0.5;
    let previous = 0;

    for (let attempt = 1; attempt <= 15; attempt++) {
      const result = computeBackoffMs(attempt, options(random));

      expect(result).toBeGreaterThanOrEqual(previous);
      previous = result;
    }
  });

  it('saturates at maxMs for a large attempt near the upper random bound', () => {
    const result = computeBackoffMs(12, options(() => 0.999999));

    expect(result).toBe(MAX_MS);
  });

  it('clamps attempt=0 and negative attempts to the attempt=1 value', () => {
    const random = () => 0.3;
    const base = computeBackoffMs(1, options(random));

    expect(computeBackoffMs(0, options(random))).toBe(base);
    expect(computeBackoffMs(-5, options(random))).toBe(base);
  });

  it('does not overflow to Infinity for a huge attempt', () => {
    const result = computeBackoffMs(10000, options(() => 0.9999));

    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeLessThanOrEqual(MAX_MS);
  });

  it('respects the cap when maxMs is smaller than baseMs', () => {
    const small = options(() => 0.9999, { baseMs: 5000, maxMs: 100 });

    expect(computeBackoffMs(1, small)).toBeLessThanOrEqual(100);
    expect(computeBackoffMs(5, small)).toBeLessThanOrEqual(100);
  });
});

describe('computeNextRunAt', () => {
  it('returns a Date strictly after now and at most now + maxMs', () => {
    const now = new Date();
    const result = computeNextRunAt(now, 3, options(() => 0.5));

    expect(result.getTime()).toBeGreaterThan(now.getTime());
    expect(result.getTime()).toBeLessThanOrEqual(now.getTime() + MAX_MS);
  });
});
