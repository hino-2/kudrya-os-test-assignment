export const PAYMENT_STATUS = {
  PAID: 'paid',
  FAILED: 'failed',
} as const;

export const PAYMENT_EVENT_STATE = {
  PENDING: 'pending',
  APPLIED: 'applied',
  ORPHAN: 'orphan',
  ABANDONED: 'abandoned',
  IGNORED_STALE: 'ignored_stale',
  IGNORED_ALREADY_PAID: 'ignored_already_paid',
  IGNORED_TERMINAL: 'ignored_terminal',
  CONFLICT: 'conflict',
  REJECTED_AMOUNT: 'rejected_amount',
} as const;
