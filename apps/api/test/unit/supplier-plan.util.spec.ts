import { describe, expect, it } from 'vitest';

import { ATTEMPT_STATE, DELIVERY_OUTCOME } from '../../src/delivery/delivery.constants';
import type { IDeliveryAttemptRow } from '../../src/delivery/delivery.interfaces';
import { SUPPLIER_CODE, SUPPLIER_ERROR_KIND, SUPPLIER_OUTCOME } from '../../src/suppliers/suppliers.constants';
import {
  allSuppliersOutOfStock,
  buildSupplierFailureReason,
  isDefinitiveOutcome,
  isOutOfStockOutcome,
  isRetriableSameSupplier,
  pickSupplier,
  resolveExhaustedOutcome,
} from '../../src/suppliers/supplier-plan.util';

// тестовый хелпер: собирает строку попытки только с полями, важными для планирования
function buildAttempt(overrides: Partial<IDeliveryAttemptRow>): IDeliveryAttemptRow {
  return {
    id: 1,
    order_id: 1,
    supplier_code: SUPPLIER_CODE.A,
    attempt_no: 1,
    request_id: 'req_1-g1-A1',
    sku: 'sku-1',
    state: ATTEMPT_STATE.FAILED,
    http_status: null,
    response_code: null,
    error_kind: null,
    error_reason: null,
    resolve_attempts: 0,
    next_resolve_at: null,
    started_at: null,
    finished_at: null,
    duration_ms: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

describe('supplier-plan.util', () => {
  describe('isRetriableSameSupplier', () => {
    it('is true only for a failed attempt with http_5xx', () => {
      expect(isRetriableSameSupplier(buildAttempt({ state: ATTEMPT_STATE.FAILED, error_kind: SUPPLIER_ERROR_KIND.HTTP_5XX }))).toBe(true);
    });

    it('is false for other error kinds or non-failed states', () => {
      expect(isRetriableSameSupplier(buildAttempt({ state: ATTEMPT_STATE.FAILED, error_kind: SUPPLIER_ERROR_KIND.HTTP_4XX }))).toBe(false);
      expect(isRetriableSameSupplier(buildAttempt({ state: ATTEMPT_STATE.UNKNOWN, error_kind: SUPPLIER_ERROR_KIND.HTTP_5XX }))).toBe(false);
    });
  });

  describe('isOutOfStockOutcome', () => {
    it('is true when error_kind is out_of_stock', () => {
      expect(isOutOfStockOutcome(buildAttempt({ error_kind: SUPPLIER_ERROR_KIND.OUT_OF_STOCK }))).toBe(true);
    });

    it('is false otherwise', () => {
      expect(isOutOfStockOutcome(buildAttempt({ error_kind: SUPPLIER_ERROR_KIND.HTTP_5XX }))).toBe(false);
    });
  });

  describe('pickSupplier', () => {
    it('picks supplier A with attemptNo 1 when there are no attempts yet', () => {
      expect(pickSupplier([], 3)).toEqual({ supplierCode: SUPPLIER_CODE.A, attemptNo: 1 });
    });

    it('retries the same supplier after http_5xx while under the per-supplier budget', () => {
      const attempts = [
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.HTTP_5XX }),
      ];

      expect(pickSupplier(attempts, 3)).toEqual({ supplierCode: SUPPLIER_CODE.A, attemptNo: 2 });
    });

    it('moves to supplier B once the per-supplier retry budget is exhausted', () => {
      const attempts = [
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.HTTP_5XX }),
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 2, error_kind: SUPPLIER_ERROR_KIND.HTTP_5XX }),
      ];

      expect(pickSupplier(attempts, 2)).toEqual({ supplierCode: SUPPLIER_CODE.B, attemptNo: 1 });
    });

    it('moves to supplier B immediately for non-http_5xx failures', () => {
      const attempts = [
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.HTTP_4XX }),
      ];

      expect(pickSupplier(attempts, 3)).toEqual({ supplierCode: SUPPLIER_CODE.B, attemptNo: 1 });
    });

    it('returns null once both suppliers in the chain are exhausted', () => {
      const attempts = [
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.HTTP_4XX }),
        buildAttempt({ supplier_code: SUPPLIER_CODE.B, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.OUT_OF_STOCK }),
      ];

      expect(pickSupplier(attempts, 3)).toBeNull();
    });
  });

  describe('allSuppliersOutOfStock / resolveExhaustedOutcome', () => {
    it('is true only when every supplier last failed with out_of_stock', () => {
      const attempts = [
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.OUT_OF_STOCK }),
        buildAttempt({ supplier_code: SUPPLIER_CODE.B, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.OUT_OF_STOCK }),
      ];

      expect(allSuppliersOutOfStock(attempts)).toBe(true);
      expect(resolveExhaustedOutcome(attempts)).toBe(DELIVERY_OUTCOME.OUT_OF_STOCK);
    });

    it('is false when at least one supplier has no attempt or a different error kind', () => {
      const attempts = [
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.OUT_OF_STOCK }),
      ];

      expect(allSuppliersOutOfStock(attempts)).toBe(false);
      expect(resolveExhaustedOutcome(attempts)).toBeNull();
    });
  });

  describe('buildSupplierFailureReason', () => {
    it('summarizes the last error kind per supplier in chain order', () => {
      const attempts = [
        buildAttempt({ supplier_code: SUPPLIER_CODE.A, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.HTTP_5XX }),
        buildAttempt({ supplier_code: SUPPLIER_CODE.B, attempt_no: 1, error_kind: SUPPLIER_ERROR_KIND.OUT_OF_STOCK }),
      ];

      expect(buildSupplierFailureReason(attempts)).toBe('A=http_5xx, B=out_of_stock');
    });

    it('marks suppliers with no attempt as no_attempt', () => {
      expect(buildSupplierFailureReason([])).toBe('A=no_attempt, B=no_attempt');
    });
  });

  describe('isDefinitiveOutcome', () => {
    it('is false only for the unknown outcome kind', () => {
      expect(isDefinitiveOutcome(SUPPLIER_OUTCOME.UNKNOWN)).toBe(false);
      expect(isDefinitiveOutcome(SUPPLIER_OUTCOME.ISSUED)).toBe(true);
      expect(isDefinitiveOutcome(SUPPLIER_OUTCOME.REJECTED)).toBe(true);
    });
  });
});
