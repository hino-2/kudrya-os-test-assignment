import { setTimeout as sleep } from 'node:timers/promises';

import { describe, expect, it } from 'vitest';

import { CorrelationStore } from '../../src/common/logging/correlation.store';

describe('CorrelationStore', () => {
  it('returns undefined when read outside any run() scope', () => {
    const store = new CorrelationStore();

    expect(store.get()).toBeUndefined();
    expect(store.traceId()).toBeNull();
  });

  it('exposes the correlation set for the current run() scope', () => {
    const store = new CorrelationStore();

    store.run({ trace_id: 'trace-1', order_id: 'order-1' }, () => {
      expect(store.get()).toEqual({ trace_id: 'trace-1', order_id: 'order-1' });
      expect(store.traceId()).toBe('trace-1');
    });

    expect(store.get()).toBeUndefined();
  });

  it('isolates correlations across concurrent async flows', async () => {
    const store = new CorrelationStore();
    const seen: string[] = [];

    const flowA = store.run({ trace_id: 'trace-a' }, async () => {
      await sleep(10);
      seen.push(store.traceId() ?? 'missing');
    });

    const flowB = store.run({ trace_id: 'trace-b' }, async () => {
      await sleep(1);
      seen.push(store.traceId() ?? 'missing');
    });

    await Promise.all([flowA, flowB]);

    expect(seen.sort()).toEqual(['trace-a', 'trace-b']);
  });

  it('lets a nested run() override the correlation only within its own scope', () => {
    const store = new CorrelationStore();

    store.run({ trace_id: 'outer' }, () => {
      store.run({ trace_id: 'outer', job_id: 42 }, () => {
        expect(store.get()).toEqual({ trace_id: 'outer', job_id: 42 });
      });

      expect(store.get()).toEqual({ trace_id: 'outer' });
    });
  });
});
