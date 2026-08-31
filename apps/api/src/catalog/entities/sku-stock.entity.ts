import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity({ name: 'sku_stock' })
export class SkuStockEntity {
  @PrimaryColumn({ type: 'bigint', name: 'product_id' })
  productId!: number;

  @Column({ type: 'integer', name: 'available_count' })
  availableCount!: number;

  @Column({ type: 'integer', name: 'reserved_count' })
  reservedCount!: number;

  @Column({ type: 'integer', name: 'issued_count' })
  issuedCount!: number;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;

  @Column({ type: 'timestamptz', name: 'last_reconciled_at', nullable: true })
  lastReconciledAt!: Date | null;
}
