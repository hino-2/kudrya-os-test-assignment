import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { StockKeyStatus } from '../inventory.type';

@Entity({ name: 'stock_keys' })
export class StockKeyEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'bigint', name: 'product_id' })
  productId!: number;

  @Column({ type: 'text', name: 'code' })
  code!: string;

  @Column({ type: 'text', name: 'status' })
  status!: StockKeyStatus;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId!: number | null;

  @Column({ type: 'text', name: 'batch' })
  batch!: string;

  @Column({ type: 'timestamptz', name: 'reserved_at', nullable: true })
  reservedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'issued_at', nullable: true })
  issuedAt!: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
