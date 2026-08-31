import type { ORDER_EVENT, ORDER_STATUS, TRANSITION_KIND } from './orders.constants';
import type { ITransitionApplyRule, ITransitionPassiveRule } from './orders.interfaces';

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

export type OrderEvent = (typeof ORDER_EVENT)[keyof typeof ORDER_EVENT];

export type TransitionKind = (typeof TRANSITION_KIND)[keyof typeof TRANSITION_KIND];

export type TransitionResult = ITransitionApplyRule | ITransitionPassiveRule;
