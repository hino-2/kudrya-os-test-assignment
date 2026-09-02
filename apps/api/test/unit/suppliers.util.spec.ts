import { describe, expect, it } from 'vitest';

import { SUPPLIER_CODE, SUPPLIER_ERROR_KIND, SUPPLIER_OUTCOME } from '../../src/suppliers/suppliers.constants';
import {
  buildSupplierRequestId,
  buildUnknownSupplierCodeMessage,
  classifySupplierHttpStatus,
  classifySupplierNetworkError,
  extractSupplierCode,
  extractSupplierReason,
  isSupplierSuccessBody,
} from '../../src/suppliers/suppliers.util';

describe('suppliers.util', () => {
  describe('buildSupplierRequestId', () => {
    it('strips the ord_ prefix and joins extId/generation/supplier/attempt', () => {
      expect(buildSupplierRequestId('ord_00042', 1, SUPPLIER_CODE.A, 1)).toBe('req_00042-g1-A1');
    });

    it('leaves extId untouched when it has no ord_ prefix', () => {
      expect(buildSupplierRequestId('00042', 1, SUPPLIER_CODE.A, 1)).toBe('req_00042-g1-A1');
    });

    it('is deterministic for the same inputs', () => {
      const first = buildSupplierRequestId('ord_00042', 2, SUPPLIER_CODE.B, 3);
      const second = buildSupplierRequestId('ord_00042', 2, SUPPLIER_CODE.B, 3);

      expect(first).toBe(second);
      expect(first).toBe('req_00042-g2-B3');
    });

    it('varies with generation, supplier code and attempt number', () => {
      const base = buildSupplierRequestId('ord_1', 1, SUPPLIER_CODE.A, 1);

      expect(buildSupplierRequestId('ord_1', 2, SUPPLIER_CODE.A, 1)).not.toBe(base);
      expect(buildSupplierRequestId('ord_1', 1, SUPPLIER_CODE.B, 1)).not.toBe(base);
      expect(buildSupplierRequestId('ord_1', 1, SUPPLIER_CODE.A, 2)).not.toBe(base);
    });
  });

  describe('isSupplierSuccessBody', () => {
    it('accepts a body with a non-empty string code, ignoring other fields', () => {
      expect(isSupplierSuccessBody({ code: 'AAAA-BBBB-CCCC' })).toBe(true);
      expect(isSupplierSuccessBody({ status: 'ok', code: 'X', extra: 123 })).toBe(true);
    });

    it('rejects a missing, empty or non-string code', () => {
      expect(isSupplierSuccessBody({})).toBe(false);
      expect(isSupplierSuccessBody({ code: '' })).toBe(false);
      expect(isSupplierSuccessBody({ code: 123 })).toBe(false);
      expect(isSupplierSuccessBody(null)).toBe(false);
      expect(isSupplierSuccessBody(undefined)).toBe(false);
      expect(isSupplierSuccessBody('not-an-object')).toBe(false);
    });
  });

  describe('extractSupplierCode / extractSupplierReason', () => {
    it('extracts a non-empty string code', () => {
      expect(extractSupplierCode({ code: 'X-Y-Z' })).toBe('X-Y-Z');
      expect(extractSupplierCode({ code: '' })).toBeNull();
      expect(extractSupplierCode(null)).toBeNull();
    });

    it('extracts a non-empty string reason', () => {
      expect(extractSupplierReason({ reason: 'out_of_stock' })).toBe('out_of_stock');
      expect(extractSupplierReason({ reason: '' })).toBeNull();
      expect(extractSupplierReason({})).toBeNull();
    });
  });

  describe('classifySupplierHttpStatus (definitive HTTP outcomes)', () => {
    it('classifies an out_of_stock reason as OUT_OF_STOCK regardless of status', () => {
      const result = classifySupplierHttpStatus(409, { status: 'error', reason: 'out_of_stock' });

      expect(result.kind).toBe(SUPPLIER_OUTCOME.OUT_OF_STOCK);
      expect(result.errorKind).toBe(SUPPLIER_ERROR_KIND.OUT_OF_STOCK);
    });

    it('classifies a 400/422 with another reason as REJECTED', () => {
      const result = classifySupplierHttpStatus(400, { status: 'error', reason: 'sku_unknown' });

      expect(result.kind).toBe(SUPPLIER_OUTCOME.REJECTED);
      expect(result.errorKind).toBe(SUPPLIER_ERROR_KIND.HTTP_4XX);
    });

    it('classifies any 5xx complete response as UNAVAILABLE, even with unparseable body', () => {
      const withBody = classifySupplierHttpStatus(500, { status: 'error', reason: 'upstream_unavailable' });
      const withoutBody = classifySupplierHttpStatus(503, null);

      expect(withBody.kind).toBe(SUPPLIER_OUTCOME.UNAVAILABLE);
      expect(withBody.errorKind).toBe(SUPPLIER_ERROR_KIND.HTTP_5XX);
      expect(withoutBody.kind).toBe(SUPPLIER_OUTCOME.UNAVAILABLE);
      expect(withoutBody.errorKind).toBe(SUPPLIER_ERROR_KIND.HTTP_5XX);
    });
  });

  describe('classifySupplierNetworkError (the timeout trap)', () => {
    it('classifies TimeoutError/AbortError as UNKNOWN, never UNAVAILABLE', () => {
      const timeoutError = Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });

      expect(classifySupplierNetworkError(timeoutError)).toEqual({
        kind: SUPPLIER_OUTCOME.UNKNOWN,
        errorKind: SUPPLIER_ERROR_KIND.TIMEOUT,
      });
      expect(classifySupplierNetworkError(abortError)).toEqual({
        kind: SUPPLIER_OUTCOME.UNKNOWN,
        errorKind: SUPPLIER_ERROR_KIND.TIMEOUT,
      });
    });

    it('classifies ECONNREFUSED/ENOTFOUND/EAI_AGAIN as UNAVAILABLE (never sent)', () => {
      for (const code of ['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']) {
        const error = Object.assign(new Error('boom'), { code });

        expect(classifySupplierNetworkError(error)).toEqual({
          kind: SUPPLIER_OUTCOME.UNAVAILABLE,
          errorKind: SUPPLIER_ERROR_KIND.CONNECTION_REFUSED,
        });
      }
    });

    it('classifies ECONNRESET-family codes as UNKNOWN (request may already be in flight)', () => {
      for (const code of ['ECONNRESET', 'UND_ERR_SOCKET', 'EPIPE']) {
        const error = Object.assign(new Error('boom'), { code });

        expect(classifySupplierNetworkError(error)).toEqual({
          kind: SUPPLIER_OUTCOME.UNKNOWN,
          errorKind: SUPPLIER_ERROR_KIND.CONNECTION_RESET,
        });
      }
    });

    it('walks one level into error.cause for undici-wrapped TypeErrors', () => {
      const wrapped = new TypeError('fetch failed');

      Object.assign(wrapped, { cause: Object.assign(new Error('inner'), { code: 'ECONNREFUSED' }) });

      expect(classifySupplierNetworkError(wrapped)).toEqual({
        kind: SUPPLIER_OUTCOME.UNAVAILABLE,
        errorKind: SUPPLIER_ERROR_KIND.CONNECTION_REFUSED,
      });
    });

    it('defaults unrecognized network errors to UNKNOWN, never to a fallback-triggering outcome', () => {
      const mystery = new Error('something odd');

      const result = classifySupplierNetworkError(mystery);

      expect(result.kind).toBe(SUPPLIER_OUTCOME.UNKNOWN);
    });
  });

  describe('buildUnknownSupplierCodeMessage', () => {
    it('interpolates the offending code into the Russian template', () => {
      expect(buildUnknownSupplierCodeMessage('Z')).toBe('Неизвестный код поставщика: Z');
    });
  });
});
