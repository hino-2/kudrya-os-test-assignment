import type { JOB_KIND, JOB_STATE } from './jobs.constants';

export type JobState = (typeof JOB_STATE)[keyof typeof JOB_STATE];

export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

export type JobPayload = Record<string, unknown>;

export type JobOutcome = 'succeeded' | 'failed';

// TypeORM возвращает для UPDATE/DELETE через dataSource.query() кортеж [rows, affectedCount],
// а не плоский массив строк (в отличие от INSERT/SELECT).
export type UpdateReturningResult<T> = [T[], number];
