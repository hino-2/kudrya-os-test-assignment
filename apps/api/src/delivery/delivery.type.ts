import type { ATTEMPT_STATE, DELIVERY_OUTCOME, DELIVERY_SOURCE } from './delivery.constants';
import type {
  IPrepareStepAttempt,
  IPrepareStepTerminal,
  ISettleStepContinue,
  ISettleStepRetryRequired,
  ISettleStepTerminal,
} from './delivery.interfaces';

export type AttemptState = (typeof ATTEMPT_STATE)[keyof typeof ATTEMPT_STATE];

export type DeliverySource = (typeof DELIVERY_SOURCE)[keyof typeof DELIVERY_SOURCE];

export type DeliveryOutcome = (typeof DELIVERY_OUTCOME)[keyof typeof DELIVERY_OUTCOME];

export type PrepareStepResult = IPrepareStepTerminal | IPrepareStepAttempt;

export type SettleStepResult = ISettleStepTerminal | ISettleStepRetryRequired | ISettleStepContinue;
