import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import { isSupportedCurrency } from '../common/money/money.util';
import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import {
  DIRECTION,
  LEDGER_IDEMPOTENCY_SEPARATOR,
  LEDGER_IMBALANCE_MESSAGE,
  LEDGER_INVALID_AMOUNT_MESSAGE,
  LEDGER_MIN_LEGS,
  LEDGER_MIXED_CURRENCY_MESSAGE,
  LEDGER_POSTING_RULE,
  LEDGER_TOO_FEW_LEGS_MESSAGE,
  LEDGER_UNSUPPORTED_CURRENCY_MESSAGE,
} from './ledger.constants';
import type { ILedgerLeg, ILedgerLegRef } from './ledger.interfaces';
import type { LedgerPostingKind } from './ledger.type';

export function assertPostableLegs(legs: readonly ILedgerLeg[]): CurrencyCode {
  if (legs.length < LEDGER_MIN_LEGS) {
    throw new DomainError(ERROR_CODE.LEDGER_UNBALANCED, LEDGER_TOO_FEW_LEGS_MESSAGE, {
      legs: legs.length,
    });
  }

  legs.forEach((leg, index) => {
    if (!Number.isSafeInteger(leg.amountMinor) || leg.amountMinor <= 0) {
      throw new DomainError(ERROR_CODE.LEDGER_UNBALANCED, LEDGER_INVALID_AMOUNT_MESSAGE, {
        index,
        amount_minor: leg.amountMinor,
      });
    }
  });

  const currency = legs[0].currency;

  if (!isSupportedCurrency(currency)) {
    throw new DomainError(ERROR_CODE.LEDGER_UNBALANCED, LEDGER_UNSUPPORTED_CURRENCY_MESSAGE, {
      currency,
    });
  }

  legs.forEach((leg, index) => {
    if (leg.currency !== currency) {
      throw new DomainError(ERROR_CODE.LEDGER_UNBALANCED, LEDGER_MIXED_CURRENCY_MESSAGE, {
        index,
        currency: leg.currency,
      });
    }
  });

  const imbalanceMinor = legs.reduce(
    (sum, leg) => sum + (leg.direction === DIRECTION.DEBIT ? leg.amountMinor : -leg.amountMinor),
    0,
  );

  if (imbalanceMinor !== 0) {
    throw new DomainError(ERROR_CODE.LEDGER_UNBALANCED, LEDGER_IMBALANCE_MESSAGE, {
      imbalance_minor: imbalanceMinor,
    });
  }

  return currency;
}

export function buildBalancedLegs(
  kind: LedgerPostingKind,
  amountMinor: MinorAmount,
  currency: CurrencyCode,
  ref?: ILedgerLegRef,
): ILedgerLeg[] {
  const rule = LEDGER_POSTING_RULE[kind];

  return [
    {
      account: rule.debit,
      direction: DIRECTION.DEBIT,
      amountMinor,
      currency,
      orderId: ref?.orderId,
      paymentEventId: ref?.paymentEventId,
      memo: ref?.memo,
    },
    {
      account: rule.credit,
      direction: DIRECTION.CREDIT,
      amountMinor,
      currency,
      orderId: ref?.orderId,
      paymentEventId: ref?.paymentEventId,
      memo: ref?.memo,
    },
  ];
}

export function buildEntryParams(
  txnId: string,
  currency: CurrencyCode,
  legs: readonly ILedgerLeg[],
  fallbackOrderId: number | null,
): unknown[] {
  return [
    txnId,
    currency,
    legs.map((leg) => leg.account),
    legs.map((leg) => leg.direction),
    legs.map((leg) => leg.amountMinor),
    legs.map((leg) => (leg.orderId === undefined ? fallbackOrderId : leg.orderId)),
    legs.map((leg) => leg.paymentEventId ?? null),
    legs.map((leg) => leg.memo ?? null),
  ];
}

export function buildPaymentCapturedKey(eventId: string): string {
  return ['payment_captured', eventId].join(LEDGER_IDEMPOTENCY_SEPARATOR);
}

export function buildDeliveryRecognizedKey(extId: string, generation: number): string {
  return ['delivery_recognized', extId, String(generation)].join(LEDGER_IDEMPOTENCY_SEPARATOR);
}

export function buildPaymentRefundedKey(extId: string): string {
  return ['payment_refunded', extId].join(LEDGER_IDEMPOTENCY_SEPARATOR);
}
