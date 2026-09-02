import { IsIn, IsInt, IsOptional, IsPositive } from 'class-validator';

import { SCENARIO_MODE } from '../../scenario/scenario.constants';
import type { ScenarioMode } from '../../scenario/scenario.type';

export class ControlScenarioDto {
  @IsIn(Object.values(SCENARIO_MODE))
  mode!: ScenarioMode;

  @IsOptional()
  @IsInt()
  @IsPositive()
  times?: number;
}
