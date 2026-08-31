import type { ATTEMPT_STATE, DELIVERY_SOURCE } from './delivery.constants';

export type AttemptState = (typeof ATTEMPT_STATE)[keyof typeof ATTEMPT_STATE];

export type DeliverySource = (typeof DELIVERY_SOURCE)[keyof typeof DELIVERY_SOURCE];
