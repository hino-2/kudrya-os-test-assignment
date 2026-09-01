import type { ACCOUNT, DIRECTION, LEDGER_TXN_KIND } from './ledger.constants';

export type Account = (typeof ACCOUNT)[keyof typeof ACCOUNT];

export type Direction = (typeof DIRECTION)[keyof typeof DIRECTION];

export type LedgerTxnKind = (typeof LEDGER_TXN_KIND)[keyof typeof LEDGER_TXN_KIND];

export type LedgerPostingKind = Exclude<
  LedgerTxnKind,
  typeof LEDGER_TXN_KIND.DELIVERY_WRITTEN_OFF
>;
