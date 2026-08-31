import { describe, expect, it } from 'vitest';

import { DomainError } from '../../src/common/errors/domain.error';
import { assertInt, isSupportedCurrency, toMajor, toMinor } from '../../src/common/money/money.util';

describe('money.util', () => {
  describe('assertInt', () => {
    it('returns the value when it is a safe integer', () => {
      expect(assertInt(500, 'amount')).toBe(500);
    });

    it('rejects non-integer numbers', () => {
      expect(() => assertInt(1.5, 'amount')).toThrow(DomainError);
    });

    it('rejects unsafe integers', () => {
      expect(() => assertInt(Number.MAX_SAFE_INTEGER + 10, 'amount')).toThrow(DomainError);
    });

    it('rejects non-number values', () => {
      expect(() => assertInt('500', 'amount')).toThrow(DomainError);
    });
  });

  describe('toMinor / toMajor', () => {
    it('converts major to minor units exactly', () => {
      expect(toMinor(500)).toBe(50000);
    });

    it('converts minor to major units exactly', () => {
      expect(toMajor(50000)).toBe(500);
    });

    it('rejects fractional major amounts', () => {
      expect(() => toMinor(500.5)).toThrow(DomainError);
    });
  });

  describe('isSupportedCurrency', () => {
    it('accepts RUB', () => {
      expect(isSupportedCurrency('RUB')).toBe(true);
    });

    it('rejects any other currency', () => {
      expect(isSupportedCurrency('USD')).toBe(false);
    });
  });
});
