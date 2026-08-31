import type { MigrationInterface, QueryRunner } from 'typeorm';

export class InitJobs1756600000004 implements MigrationInterface {
  public name = 'InitJobs1756600000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE jobs (
        id           BIGSERIAL   PRIMARY KEY,
        kind         TEXT        NOT NULL,
        dedupe_key   TEXT        NOT NULL,
        payload      JSONB       NOT NULL DEFAULT '{}'::jsonb,
        state        TEXT        NOT NULL DEFAULT 'pending',
        attempts     INTEGER     NOT NULL DEFAULT 0,
        max_attempts INTEGER     NOT NULL DEFAULT 8,
        run_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
        locked_at    TIMESTAMPTZ NULL,
        locked_by    TEXT        NULL,
        last_error   TEXT        NULL,
        trace_id     TEXT        NULL,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
        finished_at  TIMESTAMPTZ NULL,
        CONSTRAINT jobs_state_ck CHECK (state IN ('pending','running','done','dead')),
        CONSTRAINT jobs_kind_ck  CHECK (kind IN ('deliver_order','resolve_unknown_attempt'))
      ) WITH (fillfactor = 70);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX jobs_live_uq
        ON jobs (kind, dedupe_key) WHERE state IN ('pending','running');
    `);

    await queryRunner.query(`CREATE INDEX idx_jobs_claim ON jobs (run_at, id) WHERE state = 'pending';`);

    await queryRunner.query(`CREATE INDEX idx_jobs_stale ON jobs (locked_at) WHERE state = 'running';`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE jobs;`);
  }
}
