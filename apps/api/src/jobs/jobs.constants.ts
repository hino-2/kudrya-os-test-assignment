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
  -- предикат WHERE обязателен: без него Postgres не свяжет ON CONFLICT с частичным уникальным индексом
  ON CONFLICT (kind, dedupe_key) WHERE state IN ('pending','running') DO NOTHING
  RETURNING id
`;

export const JOB_HANDLERS = 'JOB_HANDLERS';

export const JOB_WORKER_INTERVAL_NAME = 'job-worker-tick';

export const WORKER_TICK_INTERVAL_MS = 200;

export const WORKER_SHUTDOWN_DRAIN_TIMEOUT_MS = 10000;

export const BACKOFF_MIN_MS = 1;

export const BACKOFF_MAX_EXPONENT = 20;

export const BACKOFF_JITTER_RATIO = 0.5;

export const JOB_LAST_ERROR_MAX_LENGTH = 1000;

export const JOB_MISSING_HANDLER_MESSAGE_TEMPLATE = 'Не найден обработчик для задачи типа %s';

export const JOB_DUPLICATE_HANDLER_MESSAGE_TEMPLATE = 'Обработчик для типа %s зарегистрирован дважды';

export const JOB_UNKNOWN_ERROR_MESSAGE = 'Неизвестная ошибка обработчика задачи';

export const JOB_OUTCOME = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
} as const;

export const JOB_CLAIM_SQL = `
  UPDATE jobs
  SET state = 'running',
      locked_at = now(),
      locked_by = $1,
      attempts = attempts + 1,
      updated_at = now()
  WHERE id IN (
    SELECT id FROM jobs
    WHERE state = 'pending' AND run_at <= now()
    ORDER BY run_at, id
    LIMIT $2
    FOR UPDATE SKIP LOCKED
  )
  RETURNING id, kind, dedupe_key, payload, state, attempts, max_attempts, run_at,
            locked_at, locked_by, last_error, trace_id, created_at, updated_at, finished_at
`;

export const JOB_COMPLETE_SQL = `
  UPDATE jobs
  SET state = 'done', finished_at = now(), updated_at = now(), locked_at = NULL, locked_by = NULL, last_error = NULL
  WHERE id = $1 AND state = 'running'
  RETURNING id
`;

export const JOB_FAIL_RETRY_SQL = `
  UPDATE jobs
  SET state = 'pending', run_at = $3, last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE id = $1 AND state = 'running'
  RETURNING id
`;

export const JOB_FAIL_DEAD_SQL = `
  UPDATE jobs
  SET state = 'dead', last_error = $2, finished_at = now(), locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE id = $1 AND state = 'running'
  RETURNING id
`;

export const JOB_RECLAIMED_STALE_LOCK_ERROR = 'reclaimed_stale_lock';

// подбирает джобы, застрявшие в state='running' дольше lockTtlMs (воркер упал/завис,
// не дойдя до complete/fail) и возвращает их в pending, чтобы их подобрал живой воркер
export const JOB_REQUEUE_STALE_SQL = `
  UPDATE jobs
  SET state = 'pending', run_at = now(), last_error = $2, locked_at = NULL, locked_by = NULL, updated_at = now()
  WHERE state = 'running' AND locked_at < now() - ($1 || ' milliseconds')::interval
  RETURNING id
`;
