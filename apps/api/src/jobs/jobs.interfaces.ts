import type { JobKind, JobPayload } from './jobs.type';

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
