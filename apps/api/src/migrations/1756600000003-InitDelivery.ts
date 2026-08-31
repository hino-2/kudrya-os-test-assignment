import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitDelivery1756600000003 implements MigrationInterface {
  public name = 'InitDelivery1756600000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE delivery_attempts (
        id               BIGSERIAL   PRIMARY KEY,
        order_id         BIGINT      NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
        supplier_code    TEXT        NOT NULL,
        attempt_no       INTEGER     NOT NULL,
        request_id       TEXT        NOT NULL,
        sku              TEXT        NOT NULL,
        state            TEXT        NOT NULL DEFAULT 'pending',
        http_status      INTEGER     NULL,
        response_code    TEXT        NULL,
        error_kind       TEXT        NULL,
        error_reason     TEXT        NULL,
        resolve_attempts INTEGER     NOT NULL DEFAULT 0,
        next_resolve_at  TIMESTAMPTZ NULL,
        started_at       TIMESTAMPTZ NULL,
        finished_at      TIMESTAMPTZ NULL,
        duration_ms      INTEGER     NULL,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT delivery_attempts_request_uq UNIQUE (request_id),
        CONSTRAINT delivery_attempts_slot_uq    UNIQUE (order_id, supplier_code, attempt_no),
        CONSTRAINT delivery_attempts_supp_ck    CHECK (supplier_code IN ('A','B')),
        CONSTRAINT delivery_attempts_state_ck   CHECK (state IN
            ('pending','in_flight','succeeded','failed','unknown','abandoned_unknown')),
        CONSTRAINT delivery_attempts_ok_ck      CHECK (state <> 'succeeded' OR response_code IS NOT NULL)
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX delivery_attempts_open_uq
        ON delivery_attempts (order_id) WHERE state IN ('pending','in_flight','unknown');
    `);

    await queryRunner.query(`
      CREATE INDEX idx_delivery_attempts_resolvable
        ON delivery_attempts (next_resolve_at) WHERE state = 'unknown';
    `);

    await queryRunner.query(`
      CREATE INDEX idx_delivery_attempts_stranded
        ON delivery_attempts (updated_at) WHERE state = 'abandoned_unknown';
    `);

    await queryRunner.query(`CREATE INDEX idx_delivery_attempts_order ON delivery_attempts (order_id, id);`);

    await queryRunner.query(`
      CREATE TABLE issued_deliveries (
        id                  BIGSERIAL   PRIMARY KEY,
        order_id            BIGINT      NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
        product_id          BIGINT      NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        sku                 TEXT        NOT NULL,
        code                TEXT        NOT NULL,
        source              TEXT        NOT NULL,
        stock_key_id        BIGINT      NULL REFERENCES stock_keys(id) ON DELETE RESTRICT,
        supplier_code       TEXT        NULL,
        delivery_attempt_id BIGINT      NULL REFERENCES delivery_attempts(id) ON DELETE RESTRICT,
        delivered_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT issued_deliveries_order_uq  UNIQUE (order_id),
        CONSTRAINT issued_deliveries_code_uq   UNIQUE (code),
        CONSTRAINT issued_deliveries_source_ck CHECK (source IN ('pool','supplier')),
        CONSTRAINT issued_deliveries_shape_ck  CHECK (
            (source = 'pool'     AND stock_key_id IS NOT NULL AND supplier_code IS NULL)
         OR (source = 'supplier' AND stock_key_id IS NULL     AND supplier_code IN ('A','B')
             AND delivery_attempt_id IS NOT NULL))
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX issued_deliveries_stock_key_uq
        ON issued_deliveries (stock_key_id) WHERE stock_key_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX issued_deliveries_attempt_uq
        ON issued_deliveries (delivery_attempt_id) WHERE delivery_attempt_id IS NOT NULL;
    `);

    await queryRunner.query(`CREATE INDEX idx_issued_deliveries_at ON issued_deliveries (delivered_at DESC);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE issued_deliveries;`);
    await queryRunner.query(`DROP TABLE delivery_attempts;`);
  }
}
