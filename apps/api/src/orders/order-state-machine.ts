import { DomainError } from '../common/errors/domain.error';
import { ERROR_CODE } from '../common/errors/errors.constants';
import {
  RECOVERABLE_ORDER_STATUSES,
  TERMINAL_ORDER_STATUSES,
  TRANSITION_TABLE,
} from './orders.constants';
import type { OrderEvent, OrderStatus, TransitionResult } from './orders.type';

export function resolveTransition(from: OrderStatus, event: OrderEvent): TransitionResult {
  const rule = TRANSITION_TABLE[from][event];

  if (rule === undefined) {
    throw new DomainError(ERROR_CODE.ILLEGAL_TRANSITION, undefined, { from, event });
  }

  return rule;
}

export function isTerminal(status: OrderStatus): boolean {
  return (TERMINAL_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}

export function isRecoverable(status: OrderStatus): boolean {
  return (RECOVERABLE_ORDER_STATUSES as readonly OrderStatus[]).includes(status);
}
