import { describe, expect, it } from 'vitest';

import { DomainError } from '../../src/common/errors/domain.error';
import { ERROR_CODE } from '../../src/common/errors/errors.constants';
import { isRecoverable, isTerminal, resolveTransition } from '../../src/orders/order-state-machine';
import { ORDER_EVENT_VALUES, ORDER_STATUS_VALUES } from '../../src/orders/orders.constants';
import type { OrderEvent, OrderStatus, TransitionKind } from '../../src/orders/orders.type';

interface ITransitionCase {
  from: OrderStatus;
  event: OrderEvent;
  kind: TransitionKind | 'illegal';
  to?: OrderStatus;
}

const TRANSITION_CASES: readonly ITransitionCase[] = [
  { from: 'created', event: 'PAYMENT_PAID', kind: 'apply', to: 'paid' },
  { from: 'created', event: 'PAYMENT_FAILED', kind: 'apply', to: 'payment_failed' },
  { from: 'created', event: 'DELIVERY_STARTED', kind: 'illegal' },
  { from: 'created', event: 'DELIVERY_SUCCEEDED', kind: 'illegal' },
  { from: 'created', event: 'DELIVERY_OUT_OF_STOCK', kind: 'illegal' },
  { from: 'created', event: 'DELIVERY_FAILED', kind: 'illegal' },
  { from: 'created', event: 'RETRY_DELIVERY', kind: 'illegal' },
  { from: 'created', event: 'ADMIN_FORCE_PAID', kind: 'illegal' },
  { from: 'created', event: 'ADMIN_REDELIVER', kind: 'illegal' },

  { from: 'paid', event: 'PAYMENT_PAID', kind: 'noop' },
  { from: 'paid', event: 'PAYMENT_FAILED', kind: 'conflict' },
  { from: 'paid', event: 'DELIVERY_STARTED', kind: 'apply', to: 'delivering' },
  { from: 'paid', event: 'DELIVERY_SUCCEEDED', kind: 'illegal' },
  { from: 'paid', event: 'DELIVERY_OUT_OF_STOCK', kind: 'apply', to: 'out_of_stock' },
  { from: 'paid', event: 'DELIVERY_FAILED', kind: 'apply', to: 'delivery_failed' },
  { from: 'paid', event: 'RETRY_DELIVERY', kind: 'illegal' },
  { from: 'paid', event: 'ADMIN_FORCE_PAID', kind: 'illegal' },
  { from: 'paid', event: 'ADMIN_REDELIVER', kind: 'illegal' },

  { from: 'delivering', event: 'PAYMENT_PAID', kind: 'noop' },
  { from: 'delivering', event: 'PAYMENT_FAILED', kind: 'conflict' },
  { from: 'delivering', event: 'DELIVERY_STARTED', kind: 'noop' },
  { from: 'delivering', event: 'DELIVERY_SUCCEEDED', kind: 'apply', to: 'delivered' },
  { from: 'delivering', event: 'DELIVERY_OUT_OF_STOCK', kind: 'apply', to: 'out_of_stock' },
  { from: 'delivering', event: 'DELIVERY_FAILED', kind: 'apply', to: 'delivery_failed' },
  { from: 'delivering', event: 'RETRY_DELIVERY', kind: 'illegal' },
  { from: 'delivering', event: 'ADMIN_FORCE_PAID', kind: 'illegal' },
  { from: 'delivering', event: 'ADMIN_REDELIVER', kind: 'illegal' },

  { from: 'delivered', event: 'PAYMENT_PAID', kind: 'noop' },
  { from: 'delivered', event: 'PAYMENT_FAILED', kind: 'conflict' },
  { from: 'delivered', event: 'DELIVERY_STARTED', kind: 'noop' },
  { from: 'delivered', event: 'DELIVERY_SUCCEEDED', kind: 'noop' },
  { from: 'delivered', event: 'DELIVERY_OUT_OF_STOCK', kind: 'noop' },
  { from: 'delivered', event: 'DELIVERY_FAILED', kind: 'noop' },
  { from: 'delivered', event: 'RETRY_DELIVERY', kind: 'illegal' },
  { from: 'delivered', event: 'ADMIN_FORCE_PAID', kind: 'illegal' },
  { from: 'delivered', event: 'ADMIN_REDELIVER', kind: 'illegal' },

  { from: 'payment_failed', event: 'PAYMENT_PAID', kind: 'conflict' },
  { from: 'payment_failed', event: 'PAYMENT_FAILED', kind: 'noop' },
  { from: 'payment_failed', event: 'DELIVERY_STARTED', kind: 'illegal' },
  { from: 'payment_failed', event: 'DELIVERY_SUCCEEDED', kind: 'illegal' },
  { from: 'payment_failed', event: 'DELIVERY_OUT_OF_STOCK', kind: 'illegal' },
  { from: 'payment_failed', event: 'DELIVERY_FAILED', kind: 'illegal' },
  { from: 'payment_failed', event: 'RETRY_DELIVERY', kind: 'illegal' },
  { from: 'payment_failed', event: 'ADMIN_FORCE_PAID', kind: 'apply', to: 'paid' },
  { from: 'payment_failed', event: 'ADMIN_REDELIVER', kind: 'illegal' },

  { from: 'out_of_stock', event: 'PAYMENT_PAID', kind: 'noop' },
  { from: 'out_of_stock', event: 'PAYMENT_FAILED', kind: 'conflict' },
  { from: 'out_of_stock', event: 'DELIVERY_STARTED', kind: 'illegal' },
  { from: 'out_of_stock', event: 'DELIVERY_SUCCEEDED', kind: 'illegal' },
  { from: 'out_of_stock', event: 'DELIVERY_OUT_OF_STOCK', kind: 'noop' },
  { from: 'out_of_stock', event: 'DELIVERY_FAILED', kind: 'illegal' },
  { from: 'out_of_stock', event: 'RETRY_DELIVERY', kind: 'apply', to: 'delivering' },
  { from: 'out_of_stock', event: 'ADMIN_FORCE_PAID', kind: 'illegal' },
  { from: 'out_of_stock', event: 'ADMIN_REDELIVER', kind: 'apply', to: 'delivering' },

  { from: 'delivery_failed', event: 'PAYMENT_PAID', kind: 'noop' },
  { from: 'delivery_failed', event: 'PAYMENT_FAILED', kind: 'conflict' },
  { from: 'delivery_failed', event: 'DELIVERY_STARTED', kind: 'illegal' },
  { from: 'delivery_failed', event: 'DELIVERY_SUCCEEDED', kind: 'illegal' },
  { from: 'delivery_failed', event: 'DELIVERY_OUT_OF_STOCK', kind: 'illegal' },
  { from: 'delivery_failed', event: 'DELIVERY_FAILED', kind: 'noop' },
  { from: 'delivery_failed', event: 'RETRY_DELIVERY', kind: 'apply', to: 'delivering' },
  { from: 'delivery_failed', event: 'ADMIN_FORCE_PAID', kind: 'illegal' },
  { from: 'delivery_failed', event: 'ADMIN_REDELIVER', kind: 'apply', to: 'delivering' },
];

const ILLEGAL_CASES = TRANSITION_CASES.filter((entry) => entry.kind === 'illegal');

function countByKind(kind: ITransitionCase['kind']): number {
  return TRANSITION_CASES.filter((entry) => entry.kind === kind).length;
}

describe('order-state-machine', () => {
  describe('coverage of the matrix', () => {
    it('spans 7 statuses x 9 events = 63 cells', () => {
      expect(ORDER_STATUS_VALUES).toHaveLength(7);
      expect(ORDER_EVENT_VALUES).toHaveLength(9);
      expect(TRANSITION_CASES).toHaveLength(63);
    });

    it('holds exactly one entry per (from, event) pair', () => {
      const pairs = TRANSITION_CASES.map((entry) => [entry.from, entry.event].join('/'));

      expect(new Set(pairs).size).toBe(63);
    });

    it('keeps the documented kind distribution', () => {
      expect(countByKind('apply')).toBe(13);
      expect(countByKind('noop')).toBe(13);
      expect(countByKind('conflict')).toBe(6);
      expect(countByKind('illegal')).toBe(31);
    });
  });

  describe('resolveTransition', () => {
    it.each(TRANSITION_CASES)('$from + $event -> $kind', ({ from, event, kind, to }) => {
      if (kind === 'apply') {
        expect(resolveTransition(from, event)).toEqual({ kind: 'apply', to });

        return;
      }

      if (kind === 'illegal') {
        expect(() => resolveTransition(from, event)).toThrow(DomainError);

        return;
      }

      expect(resolveTransition(from, event)).toEqual({ kind });
    });

    it.each(ILLEGAL_CASES)('$from + $event reports ILLEGAL_TRANSITION as 409 with the offending pair', ({ from, event }) => {
      let caught: unknown;

      try {
        resolveTransition(from, event);
      } catch (error) {
        caught = error;
      }

      expect(DomainError.isDomainError(caught)).toBe(true);

      const domainError = caught as DomainError;

      expect(domainError.code).toBe(ERROR_CODE.ILLEGAL_TRANSITION);
      expect(domainError.httpStatus).toBe(409);
      expect(domainError.details).toEqual({ from, event });
    });

    it('never targets a status outside ORDER_STATUS_VALUES', () => {
      const targets = TRANSITION_CASES.filter((entry) => entry.kind === 'apply').map((entry) => entry.to);

      for (const target of targets) {
        expect(ORDER_STATUS_VALUES).toContain(target);
      }
    });

    it('leaves a terminal status only through ADMIN_FORCE_PAID on payment_failed', () => {
      const escapes = TRANSITION_CASES.filter((entry) => entry.kind === 'apply' && isTerminal(entry.from));

      expect(escapes).toEqual([{ from: 'payment_failed', event: 'ADMIN_FORCE_PAID', kind: 'apply', to: 'paid' }]);
    });
  });

  describe('classification', () => {
    it.each(ORDER_STATUS_VALUES)('classifies %s consistently', (status) => {
      const terminal = isTerminal(status);
      const recoverable = isRecoverable(status);

      expect(terminal).toBe(status === 'delivered' || status === 'payment_failed');
      expect(recoverable).toBe(status === 'out_of_stock' || status === 'delivery_failed');
      expect(terminal && recoverable).toBe(false);
    });
  });
});
