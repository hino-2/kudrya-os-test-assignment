import type {
  ATTEMPT_STATE,
  DELIVERY_OUTCOME,
  DELIVERY_SOURCE,
  SETTLE_VIA,
} from './delivery.constants';
import type {
  IPrepareStepAttempt,
  IPrepareStepResolve,
  IPrepareStepTerminal,
  ISettleStepContinue,
  ISettleStepRetryRequired,
  ISettleStepTerminal,
} from './delivery.interfaces';

export type AttemptState = (typeof ATTEMPT_STATE)[keyof typeof ATTEMPT_STATE];

export type DeliverySource = (typeof DELIVERY_SOURCE)[keyof typeof DELIVERY_SOURCE];

export type DeliveryOutcome = (typeof DELIVERY_OUTCOME)[keyof typeof DELIVERY_OUTCOME];

export type PrepareStepResult = IPrepareStepTerminal | IPrepareStepAttempt | IPrepareStepResolve;

export type SettleVia = (typeof SETTLE_VIA)[keyof typeof SETTLE_VIA];

export type SettleStepResult = ISettleStepTerminal | ISettleStepRetryRequired | ISettleStepContinue;
