import { describe, expect, it } from 'vitest';

import { DomainError } from '../../src/common/errors/domain.error';
import { ERROR_CODE } from '../../src/common/errors/errors.constants';
import type { IProductSnapshotRow } from '../../src/orders/orders.interfaces';
import { buildOrderDraft, toIsoOrNull } from '../../src/orders/orders.util';
import type { CreateOrderRequestDto } from '../../src/orders/dto/create-order.request.dto';

function product(overrides: Partial<IProductSnapshotRow> = {}): IProductSnapshotRow {
  return {
    id: 7,
    sku: 'STEAM-TOPUP-500',
    type: 'topup',
    price_minor: 50000,
    currency: 'RUB',
    fulfillment_mode: 'supplier',
    is_active: true,
    ...overrides,
  };
}

function request(overrides: Partial<CreateOrderRequestDto> = {}): CreateOrderRequestDto {
  return { sku: 'STEAM-TOPUP-500', ...overrides };
}

describe('orders.util', () => {
  describe('toIsoOrNull', () => {
    it('keeps null as null', () => {
      expect(toIsoOrNull(null)).toBeNull();
    });

    it('renders a date as an ISO string', () => {
      expect(toIsoOrNull(new Date('2026-08-31T10:00:00.000Z'))).toBe('2026-08-31T10:00:00.000Z');
    });
  });

  describe('buildOrderDraft', () => {
    it('defaults the quantity to one', () => {
      expect(buildOrderDraft(product(), request(), 'ord_00100').quantity).toBe(1);
    });

    it('derives the total from the unit price and the quantity', () => {
      const draft = buildOrderDraft(product(), request({ quantity: 1 }), 'ord_00100');

      expect(draft.unitPriceMinor).toBe(50000);
      expect(draft.totalMinor).toBe(50000);
    });

    it('snapshots the sku and the currency from the product, not from the request', () => {
      const draft = buildOrderDraft(product({ sku: 'KEY-GTA5' }), request({ sku: 'steam-topup-500' }), 'ord_1');

      expect(draft.sku).toBe('KEY-GTA5');
      expect(draft.currency).toBe('RUB');
      expect(draft.productId).toBe(7);
      expect(draft.extId).toBe('ord_1');
    });

    it('defaults the buyer email to null and keeps it when given', () => {
      expect(buildOrderDraft(product(), request(), 'ord_00100').buyerEmail).toBeNull();
      expect(buildOrderDraft(product(), request({ buyer_email: 'a@b.io' }), 'ord_00100').buyerEmail).toBe('a@b.io');
    });

    it('rejects a price that is not a safe integer', () => {
      let caught: unknown;

      try {
        buildOrderDraft(product({ price_minor: 1.5 }), request(), 'ord_00100');
      } catch (error) {
        caught = error;
      }

      expect(DomainError.isDomainError(caught)).toBe(true);
      expect((caught as DomainError).code).toBe(ERROR_CODE.VALIDATION_FAILED);
    });
  });
});
