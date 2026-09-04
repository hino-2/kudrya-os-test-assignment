import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { ADMIN_TOKEN_HEADER } from '../../src/admin/admin.constants';
import type { IErrorEnvelope } from '../../src/common/errors/errors.interfaces';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';

let harness: IApiHarness;

beforeAll(async () => {
  harness = await startApi();
});

afterAll(async () => {
  await harness?.stop();
});

describe('AdminTokenGuard (ADMIN_API_ENABLED=false)', () => {
  it('rejects every admin route with ADMIN_DISABLED regardless of token', async () => {
    const response = await fetch(`${harness.baseUrl}/admin/sweeper/run`, {
      method: 'POST',
      headers: { [ADMIN_TOKEN_HEADER]: 'dev-admin-token' },
    });
    const body = (await response.json()) as IErrorEnvelope;

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('ADMIN_DISABLED');
  });
});
