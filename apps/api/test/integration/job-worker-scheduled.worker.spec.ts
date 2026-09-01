import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';

import { UnitOfWorkService } from '../../src/common/db/unit-of-work.service';
import { JobQueueService } from '../../src/jobs/job-queue.service';
import { JOB_KIND, JOB_STATE } from '../../src/jobs/jobs.constants';
import type { IEnqueueJobInput, IJobRow } from '../../src/jobs/jobs.interfaces';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';

const SELECT_JOB_BY_DEDUPE_KEY_SQL = 'SELECT * FROM jobs WHERE dedupe_key = $1';

const POLL_STEP_MS = 25;

const POLL_TIMEOUT_MS = 5000;

let harness: IApiHarness;

function buildEnqueueInput(overrides: Partial<IEnqueueJobInput>): IEnqueueJobInput {
  return {
    kind: JOB_KIND.DELIVER_ORDER,
    dedupeKey: `job-worker-scheduled-spec:${Math.random()}`,
    payload: { orderId: 1, ext_id: 'ord_1', generation: 1 },
    runAt: new Date(),
    traceId: null,
    ...overrides,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// поллинг вместо фиксированного sleep: тик реального @Interval не гарантирован на первой попытке
async function pollJobUntil(
  dataSource: DataSource,
  dedupeKey: string,
  predicate: (job: IJobRow) => boolean,
): Promise<IJobRow> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const rows = await dataSource.query<IJobRow[]>(SELECT_JOB_BY_DEDUPE_KEY_SQL, [dedupeKey]);
    const job = rows[0];

    if (job !== undefined && predicate(job)) {
      return job;
    }

    await delay(POLL_STEP_MS);
  }

  throw new Error(`Задача ${dedupeKey} не перешла в ожидаемое состояние за ${POLL_TIMEOUT_MS}мс`);
}

beforeAll(async () => {
  // WORKER_ENABLED=true форсирован в env.setup.worker-enabled.ts (setupFiles проекта
  // integration-worker) — envOverrides здесь не нужен и не сработал бы (см. комментарий в setup-файле)
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

describe('job worker (real scheduled @Interval tick, WORKER_ENABLED=true)', () => {
  it('claims and processes a job via the real scheduled tick, without calling runOnce() directly', async () => {
    const dedupeKey = 'scheduled-tick:job';
    const unitOfWork = harness.get(UnitOfWorkService);
    const queue = harness.get(JobQueueService);

    await unitOfWork.withTransaction((qr) => queue.enqueue(qr, buildEnqueueInput({ dedupeKey })));

    // last_error пишется отдельным UPDATE (JOB_FAIL_RETRY_SQL) уже после claim'а — поллинг
    // по attempts ловит гонку (attempts=1, last_error ещё null), поэтому ждём терминальный
    // признак ретрая, а не промежуточный
    const job = await pollJobUntil(
      harness.dataSource,
      dedupeKey,
      (row) => row.state === JOB_STATE.PENDING && row.last_error !== null,
    );

    expect(job.attempts).toBe(1);
    expect(job.last_error).not.toBeNull();
    expect(job.state).toBe(JOB_STATE.PENDING);
  });
});
