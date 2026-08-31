import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { CurrencyCode, MinorAmount } from '../../common/money/money.type';
import type { OrderStatus } from '../orders.type';

@Entity({ name: 'orders' })
export class OrderEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'text', name: 'ext_id' })
  extId!: string;

  @Column({ type: 'bigint', name: 'product_id' })
  productId!: number;

  @Column({ type: 'text', name: 'sku' })
  sku!: string;

  @Column({ type: 'integer', name: 'quantity' })
  quantity!: number;

  @Column({ type: 'bigint', name: 'unit_price_minor' })
  unitPriceMinor!: MinorAmount;

  @Column({ type: 'bigint', name: 'total_minor' })
  totalMinor!: MinorAmount;

  @Column({ type: 'char', length: 3, name: 'currency' })
  currency!: CurrencyCode;

  @Column({ type: 'text', name: 'status' })
  status!: OrderStatus;

  @Column({ type: 'text', name: 'buyer_email', nullable: true })
  buyerEmail!: string | null;

  @Column({ type: 'text', name: 'failure_reason', nullable: true })
  failureReason!: string | null;

  @Column({ type: 'integer', name: 'delivery_generation' })
  deliveryGeneration!: number;

  @Column({ type: 'text', name: 'last_payment_event_id', nullable: true })
  lastPaymentEventId!: string | null;

  @Column({ type: 'timestamptz', name: 'last_payment_event_at', nullable: true })
  lastPaymentEventAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'paid_at', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'delivering_at', nullable: true })
  deliveringAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'delivered_at', nullable: true })
  deliveredAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
