export const JOB_STATE = {
  PENDING: 'pending',
  RUNNING: 'running',
  DONE: 'done',
  DEAD: 'dead',
} as const;

export const JOB_KIND = {
  DELIVER_ORDER: 'deliver_order',
  RESOLVE_UNKNOWN_ATTEMPT: 'resolve_unknown_attempt',
} as const;
