import type { JobKind, JobPayload, JobState } from './jobs.type';

export interface IEnqueueJobInput {
  kind: JobKind;
  dedupeKey: string;
  payload: JobPayload;
  runAt: Date;
  traceId: string | null;
}

export interface IJobIdRow {
  id: number;
}

export interface IDeliverOrderPayload {
  orderId: number;
  ext_id: string;
  generation: number;
}

export interface IJobRow {
  id: number;
  kind: JobKind;
  dedupe_key: string;
  payload: JobPayload;
  state: JobState;
  attempts: number;
  max_attempts: number;
  run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  trace_id: string | null;
  created_at: Date;
  updated_at: Date;
  finished_at: Date | null;
}

export interface IClaimJobsInput {
  workerId: string;
  limit: number;
}

export interface IBackoffOptions {
  baseMs: number;
  maxMs: number;
  random?: () => number;
}

export interface IJobFailureInput {
  id: number;
  attempts: number;
  maxAttempts: number;
  error: unknown;
  backoff: IBackoffOptions;
}

export interface IJobFailureResult {
  state: JobState;
  runAt: Date | null;
}

export interface IJobHandler {
  readonly kind: JobKind;
  handle(job: IJobRow): Promise<void>;
}

export interface IWorkerCycleResult {
  claimed: number;
  succeeded: number;
  failed: number;
  dead: number;
}

export interface IJobRetryHint {
  readonly retryBackoff: IBackoffOptions;
}
