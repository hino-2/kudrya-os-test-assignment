import type { SCENARIO_MODE } from './scenario.constants';

export type ScenarioMode = (typeof SCENARIO_MODE)[keyof typeof SCENARIO_MODE];
