import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { JobKind, JobPayload, JobState } from '../jobs.type';

@Entity({ name: 'jobs' })
export class JobEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'text', name: 'kind' })
  kind!: JobKind;

  @Column({ type: 'text', name: 'dedupe_key' })
  dedupeKey!: string;

  @Column({ type: 'jsonb', name: 'payload' })
  payload!: JobPayload;

  @Column({ type: 'text', name: 'state' })
  state!: JobState;

  @Column({ type: 'integer', name: 'attempts' })
  attempts!: number;

  @Column({ type: 'integer', name: 'max_attempts' })
  maxAttempts!: number;

  @Column({ type: 'timestamptz', name: 'run_at' })
  runAt!: Date;

  @Column({ type: 'timestamptz', name: 'locked_at', nullable: true })
  lockedAt!: Date | null;

  @Column({ type: 'text', name: 'locked_by', nullable: true })
  lockedBy!: string | null;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError!: string | null;

  @Column({ type: 'text', name: 'trace_id', nullable: true })
  traceId!: string | null;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;
}
