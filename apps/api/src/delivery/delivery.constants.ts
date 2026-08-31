export const ATTEMPT_STATE = {
  PENDING: 'pending',
  IN_FLIGHT: 'in_flight',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  UNKNOWN: 'unknown',
  ABANDONED_UNKNOWN: 'abandoned_unknown',
} as const;

export const DELIVERY_SOURCE = {
  POOL: 'pool',
  SUPPLIER: 'supplier',
} as const;
