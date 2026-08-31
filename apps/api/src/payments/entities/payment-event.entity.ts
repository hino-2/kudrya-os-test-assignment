import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { CurrencyCode, MinorAmount } from '../../common/money/money.type';
import type { OrderStatus } from '../../orders/orders.type';
import type { PaymentEventState, PaymentStatus, RawWebhookPayload } from '../payments.type';

@Entity({ name: 'payment_events' })
export class PaymentEventEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'text', name: 'event_id' })
  eventId!: string;

  @Column({ type: 'text', name: 'order_ext_id' })
  orderExtId!: string;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId!: number | null;

  @Column({ type: 'text', name: 'status' })
  status!: PaymentStatus;

  @Column({ type: 'bigint', name: 'amount_minor' })
  amountMinor!: MinorAmount;

  @Column({ type: 'char', length: 3, name: 'currency' })
  currency!: CurrencyCode;

  @Column({ type: 'timestamptz', name: 'occurred_at' })
  occurredAt!: Date;

  @Column({ type: 'timestamptz', name: 'received_at' })
  receivedAt!: Date;

  @Column({ type: 'timestamptz', name: 'processed_at', nullable: true })
  processedAt!: Date | null;

  @Column({ type: 'text', name: 'state' })
  state!: PaymentEventState;

  @Column({ type: 'text', name: 'ignore_reason', nullable: true })
  ignoreReason!: string | null;

  @Column({ type: 'text', name: 'applied_from_status', nullable: true })
  appliedFromStatus!: OrderStatus | null;

  @Column({ type: 'text', name: 'applied_to_status', nullable: true })
  appliedToStatus!: OrderStatus | null;

  @Column({ type: 'text', name: 'trace_id', nullable: true })
  traceId!: string | null;

  @Column({ type: 'jsonb', name: 'raw_payload' })
  rawPayload!: RawWebhookPayload;
}
