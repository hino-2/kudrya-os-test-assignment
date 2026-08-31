import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { SupplierCode } from '../../suppliers/suppliers.type';
import type { DeliverySource } from '../delivery.type';

@Entity({ name: 'issued_deliveries' })
export class IssuedDeliveryEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'bigint', name: 'order_id' })
  orderId!: number;

  @Column({ type: 'bigint', name: 'product_id' })
  productId!: number;

  @Column({ type: 'text', name: 'sku' })
  sku!: string;

  @Column({ type: 'text', name: 'code' })
  code!: string;

  @Column({ type: 'text', name: 'source' })
  source!: DeliverySource;

  @Column({ type: 'bigint', name: 'stock_key_id', nullable: true })
  stockKeyId!: number | null;

  @Column({ type: 'text', name: 'supplier_code', nullable: true })
  supplierCode!: SupplierCode | null;

  @Column({ type: 'bigint', name: 'delivery_attempt_id', nullable: true })
  deliveryAttemptId!: number | null;

  @Column({ type: 'timestamptz', name: 'delivered_at' })
  deliveredAt!: Date;
}
