import type { CurrencyCode, MinorAmount } from '../common/money/money.type';
import type { Account, Direction, LedgerTxnKind } from './ledger.type';

export interface ILedgerLeg {
  account: Account;
  direction: Direction;
  amountMinor: MinorAmount;
  currency: CurrencyCode;
  orderId?: number | null;
  paymentEventId?: number | null;
  memo?: string | null;
}

export interface IPostTxnInput {
  kind: LedgerTxnKind;
  idempotencyKey: string;
  orderId: number | null;
  legs: readonly ILedgerLeg[];
}

export interface ILedgerPostingRule {
  debit: Account;
  credit: Account;
}

export interface ILedgerLegRef {
  orderId?: number | null;
  paymentEventId?: number | null;
  memo?: string | null;
}

export interface ITxnIdRow {
  txn_id: string;
}
