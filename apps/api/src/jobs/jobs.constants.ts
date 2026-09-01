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

export const JOB_DEDUPE_ORDER_PREFIX = 'order:';

export const JOB_TRANSACTION_REQUIRED_MESSAGE = 'Постановка задачи требует открытой транзакции';

export const JOB_ENQUEUE_SQL = `
  INSERT INTO jobs (kind, dedupe_key, payload, run_at, trace_id)
  VALUES ($1,$2,$3,$4,$5)
  ON CONFLICT (kind, dedupe_key) WHERE state IN ('pending','running') DO NOTHING
  RETURNING id
`;
