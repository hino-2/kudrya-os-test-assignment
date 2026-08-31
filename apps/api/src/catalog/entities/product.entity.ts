import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { CurrencyCode, MinorAmount } from '../../common/money/money.type';
import type { FulfillmentMode, ProductType } from '../catalog.type';

@Entity({ name: 'products' })
export class ProductEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'text', name: 'sku' })
  sku!: string;

  @Column({ type: 'text', name: 'name' })
  name!: string;

  @Column({ type: 'text', name: 'type' })
  type!: ProductType;

  @Column({ type: 'bigint', name: 'price_minor' })
  priceMinor!: MinorAmount;

  @Column({ type: 'char', length: 3, name: 'currency' })
  currency!: CurrencyCode;

  @Column({ type: 'text', name: 'image_url', nullable: true })
  imageUrl!: string | null;

  @Column({ type: 'text', name: 'fulfillment_mode' })
  fulfillmentMode!: FulfillmentMode;

  @Column({ type: 'boolean', name: 'is_active' })
  isActive!: boolean;

  @Column({ type: 'boolean', name: 'in_stock' })
  inStock!: boolean;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;

  @Column({ type: 'timestamptz', name: 'updated_at' })
  updatedAt!: Date;
}
