import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { SupplierCode } from '../../suppliers/suppliers.type';
import type { AttemptState } from '../delivery.type';

@Entity({ name: 'delivery_attempts' })
export class DeliveryAttemptEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'bigint', name: 'order_id' })
  orderId!: number;

  @Column({ type: 'text', name: 'supplier_code' })
  supplierCode!: SupplierCode;

  @Column({ type: 'integer', name: 'attempt_no' })
  attemptNo!: number;

  @Column({ type: 'text', name: 'request_id' })
  requestId!: string;

  @Column({ type: 'text', name: 'sku' })
  sku!: string;

  @Column({ type: 'text', name: 'state' })
  state!: AttemptState;

  @Column({ type: 'integer', name: 'http_status', nullable: true })
  httpStatus!: number | null;

  @Column({ type: 'text', name: 'response_code', nullable: true })
  responseCode!: string | null;

  @Column({ type: 'text', name: 'error_kind', nullable: true })
  errorKind!: string | null;

  @Column({ type: 'text', name: 'error_reason', nullable: true })
  errorReason!: string | null;

  @Column({ type: 'integer', name: 'resolve_attempts' })
  resolveAttempts!: number;

  @Column({ type: 'timestamptz', name: 'next_resolve_at', nullable: true })
  nextResolveAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'started_at', nullable: true })
  startedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'finished_at', nullable: true })
  finishedAt!: Date | null;

  @Column({ type: 'integer', name: 'duration_ms', nullable: true })
  durationMs!: number | null;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
