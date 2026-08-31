import { describe, expect, it } from 'vitest';

import { maskCode } from '../../src/common/logging/mask.util';

describe('maskCode', () => {
  it('masks the canonical XXXX-XXXX-XXXX promo-code shape, keeping a 4-char prefix and 2-char suffix', () => {
    expect(maskCode('A7X1-B2C3-D4CD')).toBe('A7X1-****-**CD');
  });

  it('fully masks a middle segment shorter than the visible windows', () => {
    expect(maskCode('AAAA-AB-ZZCD')).toBe('AAAA-**-**CD');
  });

  it('returns an empty string unchanged', () => {
    expect(maskCode('')).toBe('');
  });

  it('leaves a short single-segment code fully visible', () => {
    expect(maskCode('AB')).toBe('AB');
  });

  it('keeps both prefix and suffix visible for a single segment without dashes when they overlap', () => {
    expect(maskCode('ABCDEF')).toBe('ABCDEF');
  });

  it('masks the middle of a long single segment that has no dashes', () => {
    expect(maskCode('ABCDEFGH')).toBe('ABCD**GH');
  });

  it('preserves empty segments produced by consecutive dashes', () => {
    expect(maskCode('AAAA--ZZCD')).toBe('AAAA--**CD');
  });
});
