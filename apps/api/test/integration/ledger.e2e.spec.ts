import type { QueryRunner } from 'typeorm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DomainError } from '../../src/common/errors/domain.error';
import { LedgerService } from '../../src/ledger/ledger.service';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';

interface ITxnRow {
  txn_id: string;
  kind: string;
  idempotency_key: string;
  order_id: number | null;
}

interface IEntryRow {
  entry_seq: number;
  account: string;
  direction: string;
  amount_minor: number;
  signed_minor: number;
  currency: string;
}

interface ICountRow {
  count: number;
}

interface ISumRow {
  sum: number | null;
}

const LOCK_PROBE_MS = 150;

const PENDING = Symbol('pending');

const SELECT_TXN_BY_KEY_SQL = `
  SELECT txn_id, kind, idempotency_key, order_id
  FROM ledger_txns
  WHERE idempotency_key = $1
`;

const SELECT_ENTRIES_BY_TXN_SQL = `
  SELECT entry_seq, account, direction, amount_minor, signed_minor, currency
  FROM ledger_entries
  WHERE txn_id = $1
  ORDER BY entry_seq
`;

const COUNT_LEDGER_TXNS_SQL = 'SELECT count(*)::int AS count FROM ledger_txns';

const COUNT_LEDGER_ENTRIES_SQL = 'SELECT count(*)::int AS count FROM ledger_entries';

const SUM_SIGNED_MINOR_SQL = 'SELECT COALESCE(sum(signed_minor), 0)::bigint AS sum FROM ledger_entries';

let harness: IApiHarness;

function delay(ms: number): Promise<typeof PENDING> {
  return new Promise((resolve) => setTimeout(() => resolve(PENDING), ms));
}

async function closeRunner(runner: QueryRunner): Promise<void> {
  if (runner.isTransactionActive) {
    await runner.rollbackTransaction();
  }

  await runner.release();
}

async function scalarOf(sql: string, params: unknown[] = []): Promise<number> {
  const rows = await harness.dataSource.query<ICountRow[]>(sql, params);
  const row = rows[0];

  if (row === undefined) {
    throw new Error('Запрос счётчика не вернул строку');
  }

  return row.count;
}

async function sumSignedMinor(): Promise<number> {
  const rows = await harness.dataSource.query<ISumRow[]>(SUM_SIGNED_MINOR_SQL);
  const row = rows[0];

  if (row === undefined) {
    throw new Error('Запрос суммы не вернул строку');
  }

  return Number(row.sum ?? 0);
}

async function findTxnByKey(key: string): Promise<ITxnRow | null> {
  const rows = await harness.dataSource.query<ITxnRow[]>(SELECT_TXN_BY_KEY_SQL, [key]);

  return rows[0] ?? null;
}

async function findEntriesByTxn(txnId: string): Promise<IEntryRow[]> {
  return harness.dataSource.query<IEntryRow[]>(SELECT_ENTRIES_BY_TXN_SQL, [txnId]);
}

function requireTxn(row: ITxnRow | null): ITxnRow {
  if (row === null) {
    throw new Error('Ожидалась строка ledger_txns');
  }

  return row;
}

beforeAll(async () => {
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.dataSource);
});

describe('LedgerService.postTxn against a real connection', () => {
  it('posts a balanced payment_captured txn with database-assigned entry_seq and signed_minor', async () => {
    const service = harness.get(LedgerService);
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      const txnId = await service.postTxn(runner, {
        kind: 'payment_captured',
        idempotencyKey: 'payment_captured:evt_1',
        orderId: null,
        legs: [
          { account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' },
          { account: 'customer_prepayment', direction: 'credit', amountMinor: 50000, currency: 'RUB' },
        ],
      });

      expect(txnId).not.toBeNull();
      await runner.commitTransaction();
    } finally {
      await closeRunner(runner);
    }

    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(2);

    const txn = requireTxn(await findTxnByKey('payment_captured:evt_1'));

    expect(txn.kind).toBe('payment_captured');
    expect(txn.order_id).toBeNull();

    const entries = await findEntriesByTxn(txn.txn_id);

    expect(entries.map((entry) => entry.entry_seq)).toEqual([1, 2]);
    expect(entries.map((entry) => entry.account)).toEqual(['cash', 'customer_prepayment']);
    expect(entries.map((entry) => entry.direction)).toEqual(['debit', 'credit']);
    expect(entries.map((entry) => entry.signed_minor)).toEqual([50000, -50000]);
    expect(entries.every((entry) => entry.currency === 'RUB')).toBe(true);
    expect(entries.reduce((sum, entry) => sum + entry.signed_minor, 0)).toBe(0);
  });

  it('returns null across two separate committed transactions on the same key', async () => {
    const service = harness.get(LedgerService);
    const input = {
      kind: 'payment_captured' as const,
      idempotencyKey: 'payment_captured:evt_dup',
      orderId: null,
      legs: [
        { account: 'cash' as const, direction: 'debit' as const, amountMinor: 50000, currency: 'RUB' as const },
        {
          account: 'customer_prepayment' as const,
          direction: 'credit' as const,
          amountMinor: 50000,
          currency: 'RUB' as const,
        },
      ],
    };

    const firstRunner = harness.dataSource.createQueryRunner();

    try {
      await firstRunner.connect();
      await firstRunner.startTransaction();

      const firstTxnId = await service.postTxn(firstRunner, input);

      expect(firstTxnId).not.toBeNull();
      await firstRunner.commitTransaction();
    } finally {
      await closeRunner(firstRunner);
    }

    const secondRunner = harness.dataSource.createQueryRunner();

    try {
      await secondRunner.connect();
      await secondRunner.startTransaction();

      const secondTxnId = await service.postTxn(secondRunner, input);

      expect(secondTxnId).toBeNull();
      await secondRunner.commitTransaction();
    } finally {
      await closeRunner(secondRunner);
    }

    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(2);
  });

  it('returns null on the second call inside the same transaction', async () => {
    const service = harness.get(LedgerService);
    const input = {
      kind: 'payment_captured' as const,
      idempotencyKey: 'payment_captured:evt_same_tx',
      orderId: null,
      legs: [
        { account: 'cash' as const, direction: 'debit' as const, amountMinor: 50000, currency: 'RUB' as const },
        {
          account: 'customer_prepayment' as const,
          direction: 'credit' as const,
          amountMinor: 50000,
          currency: 'RUB' as const,
        },
      ],
    };
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      const first = await service.postTxn(runner, input);
      const second = await service.postTxn(runner, input);

      expect(first).not.toBeNull();
      expect(second).toBeNull();
      await runner.commitTransaction();
    } finally {
      await closeRunner(runner);
    }

    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(2);
  });

  it('rejects an unbalanced posting and leaves ledger_txns empty after rollback', async () => {
    const service = harness.get(LedgerService);
    const runner = harness.dataSource.createQueryRunner();

    try {
      await runner.connect();
      await runner.startTransaction();

      await expect(
        service.postTxn(runner, {
          kind: 'payment_captured',
          idempotencyKey: 'payment_captured:evt_unbalanced',
          orderId: null,
          legs: [
            { account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' },
            { account: 'customer_prepayment', direction: 'credit', amountMinor: 49000, currency: 'RUB' },
          ],
        }),
      ).rejects.toBeInstanceOf(DomainError);
    } finally {
      await closeRunner(runner);
    }

    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(0);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(0);
    expect(await sumSignedMinor()).toBe(0);
  });

  it('blocks a concurrent duplicate on the unique index until the first commits', async () => {
    const service = harness.get(LedgerService);
    const input = {
      kind: 'payment_captured' as const,
      idempotencyKey: 'payment_captured:evt_concurrent',
      orderId: null,
      legs: [
        { account: 'cash' as const, direction: 'debit' as const, amountMinor: 50000, currency: 'RUB' as const },
        {
          account: 'customer_prepayment' as const,
          direction: 'credit' as const,
          amountMinor: 50000,
          currency: 'RUB' as const,
        },
      ],
    };
    const runnerA = harness.dataSource.createQueryRunner();
    const runnerB = harness.dataSource.createQueryRunner();

    try {
      await runnerA.connect();
      await runnerA.startTransaction();

      const firstTxnId = await service.postTxn(runnerA, input);

      expect(firstTxnId).not.toBeNull();

      await runnerB.connect();
      await runnerB.startTransaction();

      const pendingB = service.postTxn(runnerB, input);

      expect(await Promise.race([pendingB, delay(LOCK_PROBE_MS)])).toBe(PENDING);

      await runnerA.commitTransaction();

      const secondTxnId = await pendingB;

      expect(secondTxnId).toBeNull();
      await runnerB.commitTransaction();
    } finally {
      await closeRunner(runnerB);
      await closeRunner(runnerA);
    }

    expect(await scalarOf(COUNT_LEDGER_TXNS_SQL)).toBe(1);
    expect(await scalarOf(COUNT_LEDGER_ENTRIES_SQL)).toBe(2);
  });
});
