import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitPayments1756600000002 implements MigrationInterface {
  public name = 'InitPayments1756600000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE payment_events (
        id                  BIGSERIAL   PRIMARY KEY,
        event_id            TEXT        NOT NULL,
        order_ext_id        TEXT        NOT NULL,
        order_id            BIGINT      NULL REFERENCES orders(id) ON DELETE SET NULL,
        status              TEXT        NOT NULL,
        amount_minor        BIGINT      NOT NULL,
        currency            CHAR(3)     NOT NULL,
        occurred_at         TIMESTAMPTZ NOT NULL,
        received_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
        processed_at        TIMESTAMPTZ NULL,
        state               TEXT        NOT NULL DEFAULT 'pending',
        ignore_reason       TEXT        NULL,
        applied_from_status TEXT        NULL,
        applied_to_status   TEXT        NULL,
        trace_id            TEXT        NULL,
        raw_payload         JSONB       NOT NULL,
        CONSTRAINT payment_events_event_uq  UNIQUE (event_id),
        CONSTRAINT payment_events_status_ck CHECK (status IN ('paid','failed')),
        CONSTRAINT payment_events_state_ck  CHECK (state IN
            ('pending','applied','orphan','abandoned','ignored_stale','ignored_already_paid',
             'ignored_terminal','conflict','rejected_amount')),
        CONSTRAINT payment_events_amount_ck CHECK (amount_minor >= 0)
      );
    `);

    await queryRunner.query(`
      CREATE INDEX idx_payment_events_orphan
        ON payment_events (order_ext_id, received_at) WHERE state = 'orphan';
    `);

    await queryRunner.query(`CREATE INDEX idx_payment_events_order ON payment_events (order_id, occurred_at DESC);`);

    await queryRunner.query(`
      CREATE INDEX idx_payment_events_conflict
        ON payment_events (received_at) WHERE state = 'conflict';
    `);

    await queryRunner.query(`
      CREATE TABLE ledger_txns (
        txn_id          UUID        PRIMARY KEY,
        kind            TEXT        NOT NULL,
        idempotency_key TEXT        NOT NULL,
        order_id        BIGINT      NULL REFERENCES orders(id) ON DELETE RESTRICT,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ledger_txns_idem_uq UNIQUE (idempotency_key),
        CONSTRAINT ledger_txns_kind_ck CHECK (kind IN
            ('payment_captured','delivery_recognized','payment_refunded','delivery_written_off'))
      );
    `);

    await queryRunner.query(`
      CREATE TABLE ledger_entries (
        id               BIGSERIAL   PRIMARY KEY,
        txn_id           UUID        NOT NULL REFERENCES ledger_txns(txn_id) ON DELETE RESTRICT,
        entry_seq        SMALLINT    NOT NULL,
        account          TEXT        NOT NULL,
        direction        TEXT        NOT NULL,
        amount_minor     BIGINT      NOT NULL,
        signed_minor     BIGINT      GENERATED ALWAYS AS
                           (CASE WHEN direction = 'debit' THEN amount_minor ELSE -amount_minor END) STORED,
        currency         CHAR(3)     NOT NULL,
        order_id         BIGINT      NULL REFERENCES orders(id) ON DELETE RESTRICT,
        payment_event_id BIGINT      NULL REFERENCES payment_events(id) ON DELETE RESTRICT,
        memo             TEXT        NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT ledger_entries_seq_uq    UNIQUE (txn_id, entry_seq),
        CONSTRAINT ledger_entries_amount_ck CHECK (amount_minor > 0),
        CONSTRAINT ledger_entries_dir_ck    CHECK (direction IN ('debit','credit')),
        CONSTRAINT ledger_entries_acct_ck   CHECK (account IN ('cash','customer_prepayment','revenue'))
      );
    `);

    await queryRunner.query(`CREATE INDEX idx_ledger_entries_txn      ON ledger_entries (txn_id);`);
    await queryRunner.query(
      `CREATE INDEX idx_ledger_entries_order    ON ledger_entries (order_id) WHERE order_id IS NOT NULL;`,
    );
    await queryRunner.query(`CREATE INDEX idx_ledger_entries_account  ON ledger_entries (account, created_at DESC);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE ledger_entries;`);
    await queryRunner.query(`DROP TABLE ledger_txns;`);
    await queryRunner.query(`DROP TABLE payment_events;`);
  }
}
