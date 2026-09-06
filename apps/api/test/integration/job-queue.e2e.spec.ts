import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppConfigService } from '../../src/common/config/app-config.service';
import { UnitOfWorkService } from '../../src/common/db/unit-of-work.service';
import { JobQueueService } from '../../src/jobs/job-queue.service';
import { JobWorkerService } from '../../src/jobs/job-worker.service';
import { JOB_KIND, JOB_STATE } from '../../src/jobs/jobs.constants';
import type { IEnqueueJobInput, IJobRow } from '../../src/jobs/jobs.interfaces';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';
import { resetDatabase } from '../helpers/pg.helper';

interface ICountRow {
  count: number;
}

const COUNT_JOBS_BY_DEDUPE_KEY_SQL = 'SELECT count(*)::int AS count FROM jobs WHERE dedupe_key = $1';

const SELECT_JOBS_BY_DEDUPE_PREFIX_SQL = 'SELECT * FROM jobs WHERE dedupe_key LIKE $1 ORDER BY id';

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

const SET_MAX_ATTEMPTS_SQL = 'UPDATE jobs SET max_attempts = $2 WHERE dedupe_key = $1';

const REASSIGN_JOB_OWNER_SQL = `
  UPDATE jobs SET locked_by = $2, locked_at = now() WHERE dedupe_key = $1
`;

const STALE_WORKER_ID = 'stale-worker';

const LIVE_WORKER_ID = 'live-worker';

const MARK_STALE_RUNNING_SQL = `
  UPDATE jobs
  SET state = 'running', locked_at = now() - ($2 || ' milliseconds')::interval, locked_by = 'dead-worker'
  WHERE dedupe_key = $1
`;

let harness: IApiHarness;

function buildEnqueueInput(overrides: Partial<IEnqueueJobInput>): IEnqueueJobInput {
  return {
    kind: JOB_KIND.DELIVER_ORDER,
    dedupeKey: `job-queue-spec:${Math.random()}`,
    payload: { orderId: 1, ext_id: 'ord_1', generation: 1 },
    runAt: new Date(),
    traceId: null,
    ...overrides,
  };
}

async function enqueue(overrides: Partial<IEnqueueJobInput>): Promise<number | null> {
  const unitOfWork = harness.get(UnitOfWorkService);
  const queue = harness.get(JobQueueService);
  const input = buildEnqueueInput(overrides);

  return unitOfWork.withTransaction((qr) => queue.enqueue(qr, input));
}

beforeAll(async () => {
  harness = await startApi({ WORKER_ENABLED: 'false' });
});

afterAll(async () => {
  await harness?.stop();
});

beforeEach(async () => {
  await resetDatabase(harness.dataSource);
});

describe('job queue + worker', () => {
  // H8: complete/fail обязаны проверять locked_by. Без предиката воркер, у которого
  // JOB_REQUEUE_STALE_SQL уже отобрал джобу, доводит её до pending/dead поверх живого
  // исполнителя, и инварианта «одна живая джоба на заказ» (jobs_live_uq) молча теряется.
  it('refuses to complete or fail a job claimed away by another worker', async () => {
    const unitOfWork = harness.get(UnitOfWorkService);
    const queue = harness.get(JobQueueService);
    const dedupeKey = 'ownership:stolen';

    await enqueue({ dedupeKey });

    const claimed = await unitOfWork.withTransaction((qr) =>
      queue.claim(qr, { workerId: STALE_WORKER_ID, limit: 1 }),
    );
    const job = claimed[0];

    expect(job).toBeDefined();
    expect(job.locked_by).toBe(STALE_WORKER_ID);

    // джобу отобрали и перезабрали: state снова running, но владелец другой
    await harness.dataSource.query(REASSIGN_JOB_OWNER_SQL, [dedupeKey, LIVE_WORKER_ID]);

    const completed = await unitOfWork.withTransaction((qr) => queue.complete(qr, job.id, STALE_WORKER_ID));

    expect(completed).toBe(false);

    const failed = await unitOfWork.withTransaction((qr) =>
      queue.fail(qr, {
        id: job.id,
        attempts: job.attempts,
        maxAttempts: job.max_attempts,
        error: new Error('stale worker'),
        backoff: { baseMs: 500, maxMs: 30000 },
        lockedBy: STALE_WORKER_ID,
      }),
    );

    expect(failed.applied).toBe(false);

    const afterRows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const after = afterRows[0];

    expect(after.state).toBe(JOB_STATE.RUNNING);
    expect(after.locked_by).toBe(LIVE_WORKER_ID);
    expect(after.last_error).toBeNull();

    // положительный контроль: настоящий владелец джобу закрывает
    const completedByOwner = await unitOfWork.withTransaction((qr) =>
      queue.complete(qr, job.id, LIVE_WORKER_ID),
    );

    expect(completedByOwner).toBe(true);
  });

  // dead-ветка идёт по отдельному оператору с другим индексом параметра ($3 против $4 у retry),
  // поэтому её нужно исполнить отдельно: ошибка в индексе всплыла бы только в проде
  it('dead-letters a job for its owner and refuses to for a stale worker', async () => {
    const unitOfWork = harness.get(UnitOfWorkService);
    const queue = harness.get(JobQueueService);
    const dedupeKey = 'ownership:dead';

    await enqueue({ dedupeKey });
    await harness.dataSource.query(SET_MAX_ATTEMPTS_SQL, [dedupeKey, 1]);

    const claimed = await unitOfWork.withTransaction((qr) =>
      queue.claim(qr, { workerId: LIVE_WORKER_ID, limit: 1 }),
    );
    const job = claimed[0];

    expect(job).toBeDefined();
    expect(job.attempts).toBe(1);

    const failure = {
      id: job.id,
      attempts: job.attempts,
      maxAttempts: job.max_attempts,
      error: new Error('dead branch'),
      backoff: { baseMs: 500, maxMs: 30000 },
    };

    const stolen = await unitOfWork.withTransaction((qr) =>
      queue.fail(qr, { ...failure, lockedBy: STALE_WORKER_ID }),
    );

    expect(stolen.state).toBe(JOB_STATE.DEAD);
    expect(stolen.applied).toBe(false);

    const owned = await unitOfWork.withTransaction((qr) =>
      queue.fail(qr, { ...failure, lockedBy: LIVE_WORKER_ID }),
    );

    expect(owned.state).toBe(JOB_STATE.DEAD);
    expect(owned.applied).toBe(true);

    const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);

    expect(rows[0].state).toBe(JOB_STATE.DEAD);
    expect(rows[0].last_error).toContain('dead branch');
  });

  // M3: JOB_ENQUEUE_SQL не писал max_attempts, поэтому все джобы получали DDL-дефолт, а
  // JOB_MAX_ATTEMPTS был мёртвой конфигурацией — бюджет ретраев не настраивался ничем
  it('writes max_attempts from the enqueue input and defaults it to the configured budget', async () => {
    const dedupeKey = `job-queue-spec:max-attempts:${Math.random()}`;
    const defaultKey = `job-queue-spec:max-attempts-default:${Math.random()}`;

    await enqueue({ dedupeKey, maxAttempts: 2 });
    await enqueue({ dedupeKey: defaultKey });

    const [trimmed] = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const [defaulted] = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [defaultKey]);

    expect(trimmed.max_attempts).toBe(2);
    expect(defaulted.max_attempts).toBe(harness.get(AppConfigService).jobs.maxAttempts);
  });

  it('deduplicates concurrent enqueue calls sharing the same dedupe key', async () => {
    const dedupeKey = 'dedupe:concurrent';
    const results = await Promise.all(
      Array.from({ length: 20 }, () => enqueue({ dedupeKey })),
    );
    const insertedIds = results.filter((id): id is number => id !== null);

    expect(insertedIds).toHaveLength(1);

    const countRows = await harness.dataSource.query<ICountRow[]>(COUNT_JOBS_BY_DEDUPE_KEY_SQL, [dedupeKey]);

    expect(countRows[0]?.count).toBe(1);
  });

  it('never claims the same job twice when two worker ticks run in parallel', async () => {
    const worker = harness.get(JobWorkerService);
    const jobCount = 8;

    await Promise.all(
      Array.from({ length: jobCount }, (_, i) => enqueue({ dedupeKey: `parallel:${i}` })),
    );

    const [resultA, resultB] = await Promise.all([worker.runOnce(), worker.runOnce()]);

    expect(resultA.claimed + resultB.claimed).toBe(jobCount);

    const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOBS_BY_DEDUPE_PREFIX_SQL, ['parallel:%']);

    expect(rows).toHaveLength(jobCount);

    for (const row of rows) {
      expect(row.attempts).toBe(1);
    }
  });

  it('reschedules a failed job for retry with backoff when attempts remain', async () => {
    const worker = harness.get(JobWorkerService);
    const dedupeKey = 'retry:job';

    await enqueue({ dedupeKey });

    const before = Date.now();
    const result = await worker.runOnce();

    expect(result.claimed).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.dead).toBe(0);

    const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const job = rows[0];

    expect(job).toBeDefined();
    expect(job.state).toBe(JOB_STATE.PENDING);
    expect(job.attempts).toBe(1);
    expect(job.last_error).not.toBeNull();
    expect(new Date(job.run_at).getTime()).toBeGreaterThan(before);
  });

  it('marks a job dead once max_attempts is exhausted', async () => {
    const worker = harness.get(JobWorkerService);
    const dedupeKey = 'dead:job';

    await enqueue({ dedupeKey });
    await harness.dataSource.query(SET_MAX_ATTEMPTS_SQL, [dedupeKey, 1]);

    const result = await worker.runOnce();

    expect(result.claimed).toBe(1);
    expect(result.dead).toBe(1);

    const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const job = rows[0];

    expect(job).toBeDefined();
    expect(job.state).toBe(JOB_STATE.DEAD);
    expect(job.finished_at).not.toBeNull();
  });

  it('reclaims a job stuck in running past the lock TTL back to pending', async () => {
    const unitOfWork = harness.get(UnitOfWorkService);
    const queue = harness.get(JobQueueService);
    const dedupeKey = 'stale:job';
    const lockTtlMs = 120000;

    await enqueue({ dedupeKey });
    await harness.dataSource.query(MARK_STALE_RUNNING_SQL, [dedupeKey, lockTtlMs + 10000]);

    const requeuedCount = await unitOfWork.withTransaction((qr) => queue.requeueStale(qr, lockTtlMs));

    expect(requeuedCount).toBe(1);

    const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const job = rows[0];

    expect(job).toBeDefined();
    expect(job.state).toBe(JOB_STATE.PENDING);
    expect(job.locked_at).toBeNull();
    expect(job.locked_by).toBeNull();
    expect(job.last_error).toBe('reclaimed_stale_lock');
  });

  it('does not reclaim a job whose lock is still within the TTL', async () => {
    const unitOfWork = harness.get(UnitOfWorkService);
    const queue = harness.get(JobQueueService);
    const dedupeKey = 'fresh:job';
    const lockTtlMs = 120000;

    await enqueue({ dedupeKey });
    await harness.dataSource.query(MARK_STALE_RUNNING_SQL, [dedupeKey, 1000]);

    const requeuedCount = await unitOfWork.withTransaction((qr) => queue.requeueStale(qr, lockTtlMs));

    expect(requeuedCount).toBe(0);

    const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);

    expect(rows[0]?.state).toBe(JOB_STATE.RUNNING);
  });

  it('does not claim a job scheduled to run in the future', async () => {
    const worker = harness.get(JobWorkerService);
    const dedupeKey = 'future:job';
    const runAt = new Date(Date.now() + 60 * 60 * 1000);

    await enqueue({ dedupeKey, runAt });

    const result = await worker.runOnce();

    expect(result.claimed).toBe(0);

    const rows = await harness.dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const job = rows[0];

    expect(job).toBeDefined();
    expect(job.state).toBe(JOB_STATE.PENDING);
    expect(job.attempts).toBe(0);
  });
});
