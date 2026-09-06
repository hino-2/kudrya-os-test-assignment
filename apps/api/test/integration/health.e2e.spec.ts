import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { IReadinessResponse } from '../../src/common/http/health.interfaces';
import {
  READINESS_COMPONENT,
  READINESS_DEGRADED_STATUS,
  READINESS_OK_STATUS,
} from '../../src/common/http/http.constants';
import { ReadinessRegistry } from '../../src/common/http/readiness.registry';
import { startApi } from '../helpers/app.harness';
import type { IApiHarness } from '../helpers/harness.interfaces';

const FAILING_PROBE_ERROR = 'проба намеренно провалена тестом';

let harness: IApiHarness;

// приложение поднимается на каждый тест: второй кейс регистрирует падающую пробу в реальном
// ReadinessRegistry, и свежий инстанс дешевле, чем откат глобального состояния реестра
beforeEach(async () => {
  harness = await startApi();
});

afterEach(async () => {
  await harness?.stop();
});

describe('GET /health/ready', () => {
  it('returns 200 with status ok while every probe is healthy', async () => {
    const response = await fetch(`${harness.baseUrl}/health/ready`);
    const body = (await response.json()) as IReadinessResponse;

    expect(response.status).toBe(READINESS_OK_STATUS);
    expect(body.status).toBe('ok');
    expect(body[READINESS_COMPONENT.DB]).toBe('ok');
  });

  it('returns 503 with status degraded when a readiness probe fails', async () => {
    harness
      .get(ReadinessRegistry)
      .register(READINESS_COMPONENT.WORKER, () => Promise.reject(new Error(FAILING_PROBE_ERROR)));

    const response = await fetch(`${harness.baseUrl}/health/ready`);
    const body = (await response.json()) as IReadinessResponse;

    expect(response.status).toBe(READINESS_DEGRADED_STATUS);
    expect(body.status).toBe('degraded');
    expect(body[READINESS_COMPONENT.WORKER]).toBe('error');
    expect(body[READINESS_COMPONENT.DB]).toBe('ok');
  });
});
