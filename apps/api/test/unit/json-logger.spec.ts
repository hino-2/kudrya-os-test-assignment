import { describe, expect, it } from 'vitest';

import { CorrelationStore } from '../../src/common/logging/correlation.store';
import { JsonLogger } from '../../src/common/logging/json-logger';
import type { ILogRecord } from '../../src/common/logging/logging.interfaces';

function createSink(): { lines: string[]; sink: (line: string) => void } {
  const lines: string[] = [];

  return { lines, sink: (line: string) => lines.push(line) };
}

describe('JsonLogger', () => {
  it('emits one JSON.parse-able line per record with the mandatory fields', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'info', format: 'json', includeStack: false, sink });

    logger.write({ level: 'info', event: 'order.created' });

    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0].trimEnd()) as ILogRecord;

    expect(record.event).toBe('order.created');
    expect(record.level).toBe('info');
    expect(record.msg).toBe('order.created');
    expect(record.trace_id).toBeNull();
    expect(record.order_id).toBeNull();
    expect(record.event_id).toBeNull();
    expect(record.request_id).toBeNull();
    expect(record.job_id).toBeNull();
    expect(typeof record.ts).toBe('string');
  });

  it('stamps the record with trace_id taken from the correlation store', () => {
    const { lines, sink } = createSink();
    const store = new CorrelationStore();
    const logger = new JsonLogger({ level: 'info', format: 'json', includeStack: false, sink }, store);

    store.run({ trace_id: 'req-123' }, () => {
      logger.write({ level: 'info', event: 'order.created' });
    });

    const record = JSON.parse(lines[0].trimEnd()) as ILogRecord;

    expect(record.trace_id).toBe('req-123');
  });

  it('filters out records below the configured minimum level', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'warn', format: 'json', includeStack: false, sink });

    logger.write({ level: 'debug', event: 'catalog.query' });
    logger.write({ level: 'info', event: 'order.created' });
    logger.write({ level: 'warn', event: 'payment.duplicate' });

    expect(lines).toHaveLength(1);
  });

  it('attaches err only for warn/error and includes the stack only when configured', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'debug', format: 'json', includeStack: true, sink });
    const error = new Error('boom');

    logger.write({ level: 'error', event: 'delivery.failed', err: error });
    logger.write({ level: 'info', event: 'order.created', err: error });

    const errorRecord = JSON.parse(lines[0].trimEnd()) as ILogRecord;
    const infoRecord = JSON.parse(lines[1].trimEnd()) as ILogRecord;

    expect(errorRecord.err?.message).toBe('boom');
    expect(errorRecord.err?.stack).toBeDefined();
    expect(infoRecord.err).toBeUndefined();
  });

  it('omits the stack when includeStack is false', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'debug', format: 'json', includeStack: false, sink });

    logger.write({ level: 'error', event: 'delivery.failed', err: new Error('boom') });

    const record = JSON.parse(lines[0].trimEnd()) as ILogRecord;

    expect(record.err?.stack).toBeUndefined();
  });

  it('does not fold a Nest shutdown-hook stack trace into ctx, keeping it on the error payload', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'debug', format: 'json', includeStack: true, sink });
    const error = new Error('shutdown boom');

    logger.error(error, error.stack);

    const record = JSON.parse(lines[0].trimEnd()) as ILogRecord;

    expect(record.ctx).toBeUndefined();
    expect(record.err?.message).toBe('shutdown boom');
    expect(record.err?.stack).toBe(error.stack);
  });

  it('still uses a plain trailing string as ctx when it is not stack-shaped', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'debug', format: 'json', includeStack: false, sink });

    logger.log('hello', 'MyController');

    const record = JSON.parse(lines[0].trimEnd()) as ILogRecord;

    expect(record.ctx).toBe('MyController');
  });

  it('keeps a repeated (non-circular) reference to the same object in the serialized output', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'info', format: 'json', includeStack: false, sink });
    const shared = { sku: 'ABC-1', qty: 2 };

    logger.write({ level: 'info', event: 'order.created', data: { before: shared, after: shared } });

    const record = JSON.parse(lines[0].trimEnd()) as ILogRecord;

    expect(record.data).toEqual({ before: shared, after: shared });
  });

  it('still drops a genuinely circular reference instead of throwing', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'info', format: 'json', includeStack: false, sink });
    const circular: Record<string, unknown> = { name: 'loop' };

    circular.self = circular;

    expect(() => logger.write({ level: 'info', event: 'order.created', data: { circular } })).not.toThrow();

    const record = JSON.parse(lines[0].trimEnd()) as ILogRecord;

    expect((record.data as { circular: { self?: unknown } }).circular.self).toBeUndefined();
  });

  it('renders a single human-readable line in pretty mode', () => {
    const { lines, sink } = createSink();
    const logger = new JsonLogger({ level: 'info', format: 'pretty', includeStack: false, sink });

    logger.write({ level: 'info', event: 'order.created', ctx: 'OrdersService' });

    expect(lines).toHaveLength(1);
    expect(() => JSON.parse(lines[0])).toThrow();
    expect(lines[0]).toContain('INFO');
    expect(lines[0]).toContain('[OrdersService]');
    expect(lines[0]).toContain('order.created');
  });
});
