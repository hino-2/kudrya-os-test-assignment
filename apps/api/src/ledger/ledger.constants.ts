import type { ILedgerPostingRule } from './ledger.interfaces';
import type { LedgerPostingKind } from './ledger.type';

export const ACCOUNT = {
  CASH: 'cash',
  CUSTOMER_PREPAYMENT: 'customer_prepayment',
  REVENUE: 'revenue',
} as const;

export const DIRECTION = {
  DEBIT: 'debit',
  CREDIT: 'credit',
} as const;

export const LEDGER_TXN_KIND = {
  PAYMENT_CAPTURED: 'payment_captured',
  DELIVERY_RECOGNIZED: 'delivery_recognized',
  PAYMENT_REFUNDED: 'payment_refunded',
  DELIVERY_WRITTEN_OFF: 'delivery_written_off',
} as const;

export const LEDGER_MIN_LEGS = 2;

export const LEDGER_IDEMPOTENCY_SEPARATOR = ':';

export const LEDGER_POSTING_RULE: Readonly<Record<LedgerPostingKind, ILedgerPostingRule>> = {
  [LEDGER_TXN_KIND.PAYMENT_CAPTURED]: { debit: ACCOUNT.CASH, credit: ACCOUNT.CUSTOMER_PREPAYMENT },
  [LEDGER_TXN_KIND.DELIVERY_RECOGNIZED]: {
    debit: ACCOUNT.CUSTOMER_PREPAYMENT,
    credit: ACCOUNT.REVENUE,
  },
  [LEDGER_TXN_KIND.PAYMENT_REFUNDED]: { debit: ACCOUNT.CUSTOMER_PREPAYMENT, credit: ACCOUNT.CASH },
};

export const LEDGER_TRANSACTION_REQUIRED_MESSAGE = 'Проводка требует открытой транзакции';

export const LEDGER_TOO_FEW_LEGS_MESSAGE = 'Проводка должна содержать минимум две записи';

export const LEDGER_INVALID_AMOUNT_MESSAGE = 'Сумма записи должна быть целым числом больше нуля';

export const LEDGER_UNSUPPORTED_CURRENCY_MESSAGE = 'Валюта проводки не поддерживается';

export const LEDGER_MIXED_CURRENCY_MESSAGE = 'Все записи проводки должны быть в одной валюте';

export const LEDGER_IMBALANCE_MESSAGE = 'Сумма дебета не равна сумме кредита';

export const LEDGER_TXN_INSERT_SQL = `
  INSERT INTO ledger_txns (txn_id, kind, idempotency_key, order_id)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (idempotency_key) DO NOTHING
  RETURNING txn_id
`;

export const LEDGER_ENTRIES_INSERT_SQL = `
  INSERT INTO ledger_entries
    (txn_id, entry_seq, account, direction, amount_minor, currency, order_id, payment_event_id, memo)
  SELECT $1, leg.ord::smallint, leg.account, leg.direction, leg.amount_minor, $2,
         leg.order_id, leg.payment_event_id, leg.memo
  FROM unnest($3::text[], $4::text[], $5::bigint[], $6::bigint[], $7::bigint[], $8::text[])
       WITH ORDINALITY AS leg(account, direction, amount_minor, order_id, payment_event_id, memo, ord)
`;
