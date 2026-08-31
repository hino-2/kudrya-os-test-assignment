import { Column, Entity, PrimaryColumn } from 'typeorm';

import type { LedgerTxnKind } from '../ledger.type';

@Entity({ name: 'ledger_txns' })
export class LedgerTxnEntity {
  @PrimaryColumn({ type: 'uuid', name: 'txn_id' })
  txnId!: string;

  @Column({ type: 'text', name: 'kind' })
  kind!: LedgerTxnKind;

  @Column({ type: 'text', name: 'idempotency_key' })
  idempotencyKey!: string;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId!: number | null;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
