import { describe, expect, it } from 'vitest';

import { AppLoggerService } from '../../src/common/logging/app-logger.service';
import { CorrelationStore } from '../../src/common/logging/correlation.store';
import { JsonLogger } from '../../src/common/logging/json-logger';

describe('AppLoggerService.withCorrelation', () => {
  it('lets an explicit patch.trace_id win over an already-open ambient scope', async () => {
    const store = new CorrelationStore();
    const logger = new JsonLogger({ level: 'info', format: 'json', includeStack: false, sink: () => {} });
    const service = new AppLoggerService(logger, store, 'TestCtx');
    const seen: Array<string | null> = [];

    await store.run({ trace_id: 'ambient-trace' }, async () => {
      await service.withCorrelation({ trace_id: 'job-trace', job_id: 7 }, async () => {
        seen.push(store.traceId());
      });
    });

    expect(seen).toEqual(['job-trace']);
  });

  it('falls back to the ambient trace_id when the patch does not specify one', async () => {
    const store = new CorrelationStore();
    const logger = new JsonLogger({ level: 'info', format: 'json', includeStack: false, sink: () => {} });
    const service = new AppLoggerService(logger, store, 'TestCtx');
    const seen: Array<string | null> = [];

    await store.run({ trace_id: 'ambient-trace' }, async () => {
      await service.withCorrelation({ job_id: 7 }, async () => {
        seen.push(store.traceId());
      });
    });

    expect(seen).toEqual(['ambient-trace']);
  });

  it('generates a fresh trace_id when there is neither an ambient scope nor a patch value', async () => {
    const store = new CorrelationStore();
    const logger = new JsonLogger({ level: 'info', format: 'json', includeStack: false, sink: () => {} });
    const service = new AppLoggerService(logger, store, 'TestCtx');
    const seen: Array<string | null> = [];

    await service.withCorrelation({ job_id: 7 }, async () => {
      seen.push(store.traceId());
    });

    expect(seen[0]).toEqual(expect.any(String));
    expect(seen[0]).not.toBeNull();
  });
});
