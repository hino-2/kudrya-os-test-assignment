import { describe, expect, it } from 'vitest';

import { isLockTimeout, isPgError, isRetryableTxError, isUniqueViolation, pgErrorCode } from '../../src/common/db/pg-error.util';

describe('pg-error.util', () => {
  describe('isPgError / pgErrorCode', () => {
    it('recognizes a directly-attached pg error code', () => {
      const error = { code: '23505', constraint: 'orders_idempotency_key_key' };

      expect(isPgError(error)).toBe(true);
      expect(pgErrorCode(error)).toBe('23505');
    });

    it('recognizes a pg error wrapped inside a TypeORM driverError', () => {
      const error = { driverError: { code: '40001' } };

      expect(isPgError(error)).toBe(true);
      expect(pgErrorCode(error)).toBe('40001');
    });

    it('returns false for a non-pg error', () => {
      expect(isPgError(new Error('boom'))).toBe(false);
      expect(isPgError(null)).toBe(false);
      expect(isPgError('boom')).toBe(false);
      expect(isPgError({})).toBe(false);
      expect(pgErrorCode(new Error('boom'))).toBeUndefined();
    });
  });

  describe('isUniqueViolation', () => {
    it('matches on the 23505 code alone when no constraint is given', () => {
      expect(isUniqueViolation({ code: '23505', constraint: 'anything' })).toBe(true);
    });

    it('matches only the named constraint when one is given', () => {
      const error = { code: '23505', constraint: 'orders_idempotency_key_key' };

      expect(isUniqueViolation(error, 'orders_idempotency_key_key')).toBe(true);
      expect(isUniqueViolation(error, 'other_constraint')).toBe(false);
    });

    it('rejects a non-unique-violation code', () => {
      expect(isUniqueViolation({ code: '23503' })).toBe(false);
    });
  });

  describe('isRetryableTxError', () => {
    it('flags serialization failure (40001) as retryable', () => {
      expect(isRetryableTxError({ code: '40001' })).toBe(true);
    });

    it('flags deadlock detected (40P01) as retryable', () => {
      expect(isRetryableTxError({ driverError: { code: '40P01' } })).toBe(true);
    });

    it('does not flag an unrelated code as retryable', () => {
      expect(isRetryableTxError({ code: '23505' })).toBe(false);
      expect(isRetryableTxError(new Error('boom'))).toBe(false);
    });
  });

  describe('isLockTimeout', () => {
    it('flags lock_not_available (55P03) as a lock timeout', () => {
      expect(isLockTimeout({ code: '55P03' })).toBe(true);
    });

    it('does not flag other codes as a lock timeout', () => {
      expect(isLockTimeout({ code: '57014' })).toBe(false);
    });
  });
});
