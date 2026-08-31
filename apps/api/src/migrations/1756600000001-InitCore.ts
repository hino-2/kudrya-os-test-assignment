import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitCore1756600000001 implements MigrationInterface {
  public name = 'InitCore1756600000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE order_ext_seq START 100;`);

    await queryRunner.query(`
      CREATE TABLE products (
        id                BIGSERIAL     PRIMARY KEY,
        sku               TEXT          COLLATE "C" NOT NULL,
        name              TEXT          NOT NULL,
        type              TEXT          NOT NULL,
        price_minor       BIGINT        NOT NULL,
        currency          CHAR(3)       NOT NULL DEFAULT 'RUB',
        image_url         TEXT          NULL,
        fulfillment_mode  TEXT          NOT NULL,
        is_active         BOOLEAN       NOT NULL DEFAULT TRUE,
        in_stock          BOOLEAN       NOT NULL DEFAULT FALSE,
        created_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
        updated_at        TIMESTAMPTZ   NOT NULL DEFAULT now(),
        CONSTRAINT products_sku_uq        UNIQUE (sku),
        CONSTRAINT products_type_ck       CHECK (type IN ('key','topup','subscription','giftcard')),
        CONSTRAINT products_mode_ck       CHECK (fulfillment_mode IN ('pool','supplier')),
        CONSTRAINT products_price_ck      CHECK (price_minor > 0),
        CONSTRAINT products_currency_ck   CHECK (currency = 'RUB'),
        CONSTRAINT products_mode_type_ck  CHECK ((type = 'key') = (fulfillment_mode = 'pool'))
      ) WITH (fillfactor = 90);
    `);

    await queryRunner.query(`
      CREATE TABLE sku_stock (
        product_id          BIGINT      PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
        available_count     INTEGER     NOT NULL DEFAULT 0,
        reserved_count      INTEGER     NOT NULL DEFAULT 0,
        issued_count        INTEGER     NOT NULL DEFAULT 0,
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_reconciled_at  TIMESTAMPTZ NULL,
        CONSTRAINT sku_stock_available_ck CHECK (available_count >= 0),
        CONSTRAINT sku_stock_reserved_ck  CHECK (reserved_count  >= 0),
        CONSTRAINT sku_stock_issued_ck    CHECK (issued_count    >= 0)
      ) WITH (fillfactor = 70);
    `);

    await queryRunner.query(`
      CREATE TABLE orders (
        id                     BIGSERIAL   PRIMARY KEY,
        ext_id                 TEXT        NOT NULL,
        product_id             BIGINT      NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        sku                    TEXT        NOT NULL,
        quantity               INTEGER     NOT NULL DEFAULT 1,
        unit_price_minor       BIGINT      NOT NULL,
        total_minor            BIGINT      NOT NULL,
        currency               CHAR(3)     NOT NULL DEFAULT 'RUB',
        status                 TEXT        NOT NULL DEFAULT 'created',
        buyer_email            TEXT        NULL,
        failure_reason         TEXT        NULL,
        delivery_generation    INTEGER     NOT NULL DEFAULT 0,
        last_payment_event_id  TEXT        NULL,
        last_payment_event_at  TIMESTAMPTZ NULL,
        paid_at                TIMESTAMPTZ NULL,
        delivering_at          TIMESTAMPTZ NULL,
        delivered_at           TIMESTAMPTZ NULL,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
        CONSTRAINT orders_ext_uq      UNIQUE (ext_id),
        CONSTRAINT orders_status_ck   CHECK (status IN
            ('created','paid','delivering','delivered','payment_failed','out_of_stock','delivery_failed')),
        CONSTRAINT orders_qty_ck      CHECK (quantity = 1),
        CONSTRAINT orders_total_ck    CHECK (total_minor = unit_price_minor * quantity AND total_minor > 0),
        CONSTRAINT orders_paid_ck     CHECK (status <> 'created' OR paid_at IS NULL)
      );
    `);

    await queryRunner.query(`
      CREATE TABLE stock_keys (
        id           BIGSERIAL    PRIMARY KEY,
        product_id   BIGINT       NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
        code         TEXT         NOT NULL,
        status       TEXT         NOT NULL DEFAULT 'available',
        order_id     BIGINT       NULL REFERENCES orders(id) ON DELETE RESTRICT,
        batch        TEXT         NOT NULL DEFAULT 'seed',
        reserved_at  TIMESTAMPTZ  NULL,
        issued_at    TIMESTAMPTZ  NULL,
        created_at   TIMESTAMPTZ  NOT NULL DEFAULT now(),
        CONSTRAINT stock_keys_status_ck CHECK (status IN ('available','reserved','issued')),
        CONSTRAINT stock_keys_code_uq   UNIQUE (product_id, code),
        CONSTRAINT stock_keys_link_ck   CHECK (
            (status = 'available' AND order_id IS NULL)
         OR (status IN ('reserved','issued') AND order_id IS NOT NULL))
      );
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX stock_keys_order_uq
        ON stock_keys (order_id) WHERE order_id IS NOT NULL;
    `);

    await queryRunner.query(`
      CREATE INDEX idx_stock_keys_available
        ON stock_keys (product_id, id) WHERE status = 'available';
    `);

    await queryRunner.query(`
      CREATE INDEX idx_orders_paid_undelivered
        ON orders (paid_at)
        WHERE paid_at IS NOT NULL AND status <> 'delivered' AND status <> 'payment_failed';
    `);

    await queryRunner.query(`
      CREATE INDEX idx_orders_recoverable
        ON orders (updated_at)
        WHERE status IN ('out_of_stock','delivery_failed','delivering');
    `);

    await queryRunner.query(`CREATE INDEX idx_orders_status_created ON orders (status, created_at DESC);`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE stock_keys;`);
    await queryRunner.query(`DROP TABLE orders;`);
    await queryRunner.query(`DROP TABLE sku_stock;`);
    await queryRunner.query(`DROP TABLE products;`);
    await queryRunner.query(`DROP SEQUENCE order_ext_seq;`);
  }
}
