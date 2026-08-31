import type { JOB_KIND, JOB_STATE } from './jobs.constants';

export type JobState = (typeof JOB_STATE)[keyof typeof JOB_STATE];

export type JobKind = (typeof JOB_KIND)[keyof typeof JOB_KIND];

export type JobPayload = Record<string, unknown>;
