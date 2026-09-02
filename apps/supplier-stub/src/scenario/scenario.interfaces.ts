import type { ScenarioMode } from './scenario.type';

export interface IScenarioState {
  mode: ScenarioMode;
  remaining: number | null;
}
