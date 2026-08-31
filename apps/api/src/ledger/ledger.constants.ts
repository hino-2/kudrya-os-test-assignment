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
