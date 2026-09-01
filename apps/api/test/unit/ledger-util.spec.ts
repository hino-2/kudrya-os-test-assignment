import { describe, expect, it } from 'vitest';

import { DomainError } from '../../src/common/errors/domain.error';
import { ERROR_CODE } from '../../src/common/errors/errors.constants';
import { ACCOUNT, DIRECTION, LEDGER_TXN_KIND } from '../../src/ledger/ledger.constants';
import type { ILedgerLeg } from '../../src/ledger/ledger.interfaces';
import type { LedgerPostingKind } from '../../src/ledger/ledger.type';
import {
  assertPostableLegs,
  buildBalancedLegs,
  buildDeliveryRecognizedKey,
  buildEntryParams,
  buildPaymentCapturedKey,
  buildPaymentRefundedKey,
} from '../../src/ledger/ledger.util';

function thrownCode(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'NOT_DOMAIN_ERROR';
  }

  return 'NO_ERROR';
}

function leg(patch: Partial<Omit<ILedgerLeg, 'currency'>> & { currency?: string }): ILedgerLeg {
  return {
    account: ACCOUNT.CASH,
    direction: DIRECTION.DEBIT,
    amountMinor: 50000,
    currency: 'RUB',
    ...patch,
  } as ILedgerLeg;
}

describe('ledger.util', () => {
  describe('assertPostableLegs', () => {
    it('returns the shared currency for a balanced two-leg posting', () => {
      const legs = [
        leg({ account: ACCOUNT.CASH, direction: DIRECTION.DEBIT, amountMinor: 50000 }),
        leg({ account: ACCOUNT.CUSTOMER_PREPAYMENT, direction: DIRECTION.CREDIT, amountMinor: 50000 }),
      ];

      expect(assertPostableLegs(legs)).toBe('RUB');
    });

    it('accepts a balanced four-leg posting (2 debits + 2 credits summing to zero)', () => {
      const legs = [
        leg({ account: ACCOUNT.CASH, direction: DIRECTION.DEBIT, amountMinor: 30000 }),
        leg({ account: ACCOUNT.CASH, direction: DIRECTION.DEBIT, amountMinor: 20000 }),
        leg({ account: ACCOUNT.CUSTOMER_PREPAYMENT, direction: DIRECTION.CREDIT, amountMinor: 10000 }),
        leg({ account: ACCOUNT.CUSTOMER_PREPAYMENT, direction: DIRECTION.CREDIT, amountMinor: 40000 }),
      ];

      expect(assertPostableLegs(legs)).toBe('RUB');
    });

    it('rejects zero legs', () => {
      expect(thrownCode(() => assertPostableLegs([]))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects a single leg', () => {
      const legs = [leg({})];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects a zero amount', () => {
      const legs = [leg({ amountMinor: 0 }), leg({ direction: DIRECTION.CREDIT })];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects a negative amount', () => {
      const legs = [leg({ amountMinor: -1 }), leg({ direction: DIRECTION.CREDIT })];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects a fractional amount', () => {
      const legs = [leg({ amountMinor: 1.5 }), leg({ direction: DIRECTION.CREDIT })];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects an unsafe integer amount', () => {
      const legs = [
        leg({ amountMinor: Number.MAX_SAFE_INTEGER + 10 }),
        leg({ direction: DIRECTION.CREDIT }),
      ];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects an unsupported currency', () => {
      const legs = [
        leg({ currency: 'USD' }),
        leg({ direction: DIRECTION.CREDIT, currency: 'USD' }),
      ];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects mixed currencies', () => {
      const legs = [leg({ currency: 'RUB' }), leg({ direction: DIRECTION.CREDIT, currency: 'USD' })];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });

    it('rejects debit not equal to credit', () => {
      const legs = [
        leg({ amountMinor: 10000 }),
        leg({ direction: DIRECTION.CREDIT, amountMinor: 9000 }),
      ];

      expect(thrownCode(() => assertPostableLegs(legs))).toBe(ERROR_CODE.LEDGER_UNBALANCED);
    });
  });

  describe('buildBalancedLegs', () => {
    it.each<{ kind: LedgerPostingKind; debit: string; credit: string }>([
      { kind: LEDGER_TXN_KIND.PAYMENT_CAPTURED, debit: ACCOUNT.CASH, credit: ACCOUNT.CUSTOMER_PREPAYMENT },
      {
        kind: LEDGER_TXN_KIND.DELIVERY_RECOGNIZED,
        debit: ACCOUNT.CUSTOMER_PREPAYMENT,
        credit: ACCOUNT.REVENUE,
      },
      { kind: LEDGER_TXN_KIND.PAYMENT_REFUNDED, debit: ACCOUNT.CUSTOMER_PREPAYMENT, credit: ACCOUNT.CASH },
    ])('produces [$debit, $credit] for $kind', ({ kind, debit, credit }) => {
      const legs = buildBalancedLegs(kind, 50000, 'RUB', { orderId: 7, paymentEventId: 9 });

      expect(legs).toHaveLength(2);
      expect(legs[0].account).toBe(debit);
      expect(legs[0].direction).toBe(DIRECTION.DEBIT);
      expect(legs[1].account).toBe(credit);
      expect(legs[1].direction).toBe(DIRECTION.CREDIT);
      expect(legs[0].amountMinor).toBe(50000);
      expect(legs[1].amountMinor).toBe(50000);
      expect(legs[0].currency).toBe('RUB');
      expect(legs[1].currency).toBe('RUB');
      expect(legs[0].orderId).toBe(7);
      expect(legs[1].orderId).toBe(7);
      expect(legs[0].paymentEventId).toBe(9);
      expect(legs[1].paymentEventId).toBe(9);
      expect(() => assertPostableLegs(legs)).not.toThrow();
    });
  });

  describe('buildEntryParams', () => {
    it('orders every array by leg order and carries the fallback order id', () => {
      const legs = [
        leg({ account: ACCOUNT.CASH, direction: DIRECTION.DEBIT, amountMinor: 50000 }),
        leg({
          account: ACCOUNT.CUSTOMER_PREPAYMENT,
          direction: DIRECTION.CREDIT,
          amountMinor: 50000,
          orderId: null,
        }),
      ];
      const params = buildEntryParams('txn-1', 'RUB', legs, 42);

      expect(params).toEqual([
        'txn-1',
        'RUB',
        ['cash', 'customer_prepayment'],
        ['debit', 'credit'],
        [50000, 50000],
        [42, null],
        [null, null],
        [null, null],
      ]);
    });

    it('inherits fallbackOrderId only when orderId is omitted, and keeps an explicit null', () => {
      const legs = [leg({ orderId: undefined }), leg({ direction: DIRECTION.CREDIT, orderId: null })];
      const params = buildEntryParams('txn-2', 'RUB', legs, 42);

      expect(params[5]).toEqual([42, null]);
    });

    it('defaults missing memo and paymentEventId to null', () => {
      const legs = [leg({}), leg({ direction: DIRECTION.CREDIT })];
      const params = buildEntryParams('txn-3', 'RUB', legs, null);

      expect(params[6]).toEqual([null, null]);
      expect(params[7]).toEqual([null, null]);
    });
  });

  describe('key builders', () => {
    it('builds the payment_captured key', () => {
      expect(buildPaymentCapturedKey('evt_1')).toBe('payment_captured:evt_1');
    });

    it('builds the delivery_recognized key', () => {
      expect(buildDeliveryRecognizedKey('ord_00123', 2)).toBe('delivery_recognized:ord_00123:2');
    });

    it('builds the payment_refunded key', () => {
      expect(buildPaymentRefundedKey('ord_00123')).toBe('payment_refunded:ord_00123');
    });
  });
});
