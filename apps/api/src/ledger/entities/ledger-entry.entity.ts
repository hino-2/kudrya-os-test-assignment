import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

import type { CurrencyCode, MinorAmount } from '../../common/money/money.type';
import type { Account, Direction } from '../ledger.type';

@Entity({ name: 'ledger_entries' })
export class LedgerEntryEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint', name: 'id' })
  id!: number;

  @Column({ type: 'uuid', name: 'txn_id' })
  txnId!: string;

  @Column({ type: 'smallint', name: 'entry_seq' })
  entrySeq!: number;

  @Column({ type: 'text', name: 'account' })
  account!: Account;

  @Column({ type: 'text', name: 'direction' })
  direction!: Direction;

  @Column({ type: 'bigint', name: 'amount_minor' })
  amountMinor!: MinorAmount;

  @Column({ type: 'bigint', name: 'signed_minor', insert: false, update: false })
  signedMinor!: MinorAmount;

  @Column({ type: 'char', length: 3, name: 'currency' })
  currency!: CurrencyCode;

  @Column({ type: 'bigint', name: 'order_id', nullable: true })
  orderId!: number | null;

  @Column({ type: 'bigint', name: 'payment_event_id', nullable: true })
  paymentEventId!: number | null;

  @Column({ type: 'text', name: 'memo', nullable: true })
  memo!: string | null;

  @Column({ type: 'timestamptz', name: 'created_at' })
  createdAt!: Date;
}
