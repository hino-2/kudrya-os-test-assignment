import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SweeperRunResponseDto } from '../../src/admin/dto/sweeper-run.response.dto';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';

let harness: IApiHarness;

beforeAll(async () => {
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

describe('AdminTokenGuard (ADMIN_TOKEN empty)', () => {
  it('bypasses token check when no x-admin-token header is sent', async () => {
    const response = await fetch(`${harness.baseUrl}/admin/sweeper/run`, { method: 'POST' });
    const body = (await response.json()) as SweeperRunResponseDto;

    expect(response.status).toBe(200);
    expect(body.reclaimed_stale_jobs).toEqual(expect.any(Number));
  });

  it('bypasses token check even with a wrong x-admin-token header', async () => {
    const response = await fetch(`${harness.baseUrl}/admin/sweeper/run`, {
      method: 'POST',
      headers: { 'x-admin-token': 'wrong-token' },
    });
    const body = (await response.json()) as SweeperRunResponseDto;

    expect(response.status).toBe(200);
    expect(body.reclaimed_stale_jobs).toEqual(expect.any(Number));
  });
});
