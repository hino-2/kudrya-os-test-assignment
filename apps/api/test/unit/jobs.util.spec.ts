import { describe, expect, it } from 'vitest';

import { readJobBackoffHint } from '../../src/jobs/jobs.util';

describe('readJobBackoffHint', () => {
  it('returns null for a plain error with no retryBackoff hint', () => {
    expect(readJobBackoffHint(new Error('boom'))).toBeNull();
  });

  it('returns null for non-object errors', () => {
    expect(readJobBackoffHint('boom')).toBeNull();
    expect(readJobBackoffHint(null)).toBeNull();
    expect(readJobBackoffHint(undefined)).toBeNull();
  });

  it('returns null when retryBackoff is present but malformed', () => {
    const error = Object.assign(new Error('boom'), { retryBackoff: { baseMs: 'nope' } });

    expect(readJobBackoffHint(error)).toBeNull();
  });

  it('returns the hint when retryBackoff has numeric baseMs/maxMs', () => {
    const error = Object.assign(new Error('boom'), { retryBackoff: { baseMs: 100, maxMs: 5000 } });

    expect(readJobBackoffHint(error)).toEqual({ baseMs: 100, maxMs: 5000 });
  });
});
