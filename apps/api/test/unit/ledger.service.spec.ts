import type { DataSource, QueryRunner } from 'typeorm';
import { describe, expect, it } from 'vitest';

import { DomainError } from '../../src/common/errors/domain.error';
import { CorrelationStore } from '../../src/common/logging/correlation.store';
import { AppLoggerService } from '../../src/common/logging/app-logger.service';
import { JsonLogger } from '../../src/common/logging/json-logger';
import {
  LEDGER_ENTRIES_INSERT_SQL,
  LEDGER_TXN_INSERT_SQL,
} from '../../src/ledger/ledger.constants';
import type { ITxnIdRow } from '../../src/ledger/ledger.interfaces';
import { LedgerService } from '../../src/ledger/ledger.service';

interface IRecordedQuery {
  sql: string;
  params: unknown[];
}

class FakeDataSource {
  readonly calls: IRecordedQuery[] = [];

  constructor(private readonly txnRows: ITxnIdRow[]) {}

  async query(sql: string, params: unknown[]): Promise<unknown> {
    this.calls.push({ sql, params });

    return sql === LEDGER_TXN_INSERT_SQL ? this.txnRows : [];
  }
}

async function rejectedCode(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof DomainError ? error.code : 'NOT_DOMAIN_ERROR';
  }

  return 'NO_ERROR';
}

function buildLogger(): AppLoggerService {
  return new AppLoggerService(
    new JsonLogger({ level: 'error', format: 'json', includeStack: false, sink: () => {} }),
    new CorrelationStore(),
    'LedgerService',
  );
}

function buildService(txnRows: ITxnIdRow[]): { service: LedgerService; fake: FakeDataSource } {
  const fake = new FakeDataSource(txnRows);
  const service = new LedgerService(fake as unknown as DataSource, buildLogger());

  return { service, fake };
}

function activeQr(): QueryRunner {
  return { isTransactionActive: true } as unknown as QueryRunner;
}

function inactiveQr(): QueryRunner {
  return { isTransactionActive: false } as unknown as QueryRunner;
}

describe('LedgerService.postTxn', () => {
  it('posts a header and its legs, returning the generated txn_id', async () => {
    const echoTxnId = 'echo-uuid';
    const { service, fake } = buildService([{ txn_id: echoTxnId }]);

    const txnId = await service.postTxn(activeQr(), {
      kind: 'payment_captured',
      idempotencyKey: 'payment_captured:evt_1',
      orderId: 42,
      legs: [
        { account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' },
        { account: 'customer_prepayment', direction: 'credit', amountMinor: 50000, currency: 'RUB' },
      ],
    });

    expect(txnId).toBe(echoTxnId);
    expect(fake.calls).toHaveLength(2);

    const [header, entries] = fake.calls;

    expect(header.sql).toBe(LEDGER_TXN_INSERT_SQL);
    expect(header.params[0]).toEqual(expect.any(String));
    expect(header.params.slice(1)).toEqual(['payment_captured', 'payment_captured:evt_1', 42]);
    expect(entries.sql).toBe(LEDGER_ENTRIES_INSERT_SQL);
    expect(entries.params[1]).toBe('RUB');
    expect(entries.params[2]).toEqual(['cash', 'customer_prepayment']);
    expect(entries.params[3]).toEqual(['debit', 'credit']);
    expect(entries.params[4]).toEqual([50000, 50000]);
  });

  it('returns null and writes no legs when the idempotency key already exists', async () => {
    const { service, fake } = buildService([]);

    const txnId = await service.postTxn(activeQr(), {
      kind: 'payment_captured',
      idempotencyKey: 'payment_captured:evt_1',
      orderId: 42,
      legs: [
        { account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' },
        { account: 'customer_prepayment', direction: 'credit', amountMinor: 50000, currency: 'RUB' },
      ],
    });

    expect(txnId).toBeNull();
    expect(fake.calls).toHaveLength(1);
  });

  it('rejects an unbalanced posting before touching the database', async () => {
    const { service, fake } = buildService([{ txn_id: 'unused' }]);

    const code = await rejectedCode(() =>
      service.postTxn(activeQr(), {
        kind: 'payment_captured',
        idempotencyKey: 'payment_captured:evt_1',
        orderId: 42,
        legs: [
          { account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' },
          { account: 'customer_prepayment', direction: 'credit', amountMinor: 49000, currency: 'RUB' },
        ],
      }),
    );

    expect(code).toBe('LEDGER_UNBALANCED');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects a single leg before touching the database', async () => {
    const { service, fake } = buildService([{ txn_id: 'unused' }]);

    const code = await rejectedCode(() =>
      service.postTxn(activeQr(), {
        kind: 'payment_captured',
        idempotencyKey: 'payment_captured:evt_1',
        orderId: 42,
        legs: [{ account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' }],
      }),
    );

    expect(code).toBe('LEDGER_UNBALANCED');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects mixed currencies before touching the database', async () => {
    const { service, fake } = buildService([{ txn_id: 'unused' }]);

    const code = await rejectedCode(() =>
      service.postTxn(activeQr(), {
        kind: 'payment_captured',
        idempotencyKey: 'payment_captured:evt_1',
        orderId: 42,
        legs: [
          { account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' },
          {
            account: 'customer_prepayment',
            direction: 'credit',
            amountMinor: 50000,
            currency: 'USD' as never,
          },
        ],
      }),
    );

    expect(code).toBe('LEDGER_UNBALANCED');
    expect(fake.calls).toHaveLength(0);
  });

  it('rejects a non-positive amount before touching the database', async () => {
    const { service, fake } = buildService([{ txn_id: 'unused' }]);

    const code = await rejectedCode(() =>
      service.postTxn(activeQr(), {
        kind: 'payment_captured',
        idempotencyKey: 'payment_captured:evt_1',
        orderId: 42,
        legs: [
          { account: 'cash', direction: 'debit', amountMinor: 0, currency: 'RUB' },
          { account: 'customer_prepayment', direction: 'credit', amountMinor: 0, currency: 'RUB' },
        ],
      }),
    );

    expect(code).toBe('LEDGER_UNBALANCED');
    expect(fake.calls).toHaveLength(0);
  });

  it('refuses to run without an open transaction', async () => {
    const { service, fake } = buildService([{ txn_id: 'unused' }]);

    const code = await rejectedCode(() =>
      service.postTxn(inactiveQr(), {
        kind: 'payment_captured',
        idempotencyKey: 'payment_captured:evt_1',
        orderId: 42,
        legs: [
          { account: 'cash', direction: 'debit', amountMinor: 50000, currency: 'RUB' },
          { account: 'customer_prepayment', direction: 'credit', amountMinor: 50000, currency: 'RUB' },
        ],
      }),
    );

    expect(code).toBe('INTERNAL_ERROR');
    expect(fake.calls).toHaveLength(0);
  });

  it('generates a fresh txn_id per successful posting', async () => {
    const { service, fake } = buildService([{ txn_id: 'server-assigned' }]);
    const input = {
      kind: 'payment_captured' as const,
      idempotencyKey: 'payment_captured:evt_1',
      orderId: 42,
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

    await service.postTxn(activeQr(), input);
    await service.postTxn(activeQr(), input);

    const headerCalls = fake.calls.filter((call) => call.sql === LEDGER_TXN_INSERT_SQL);

    expect(headerCalls).toHaveLength(2);
    expect(headerCalls[0].params[0]).not.toBe(headerCalls[1].params[0]);
  });
});
