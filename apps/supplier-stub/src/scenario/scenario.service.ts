import { Injectable } from '@nestjs/common';

import { StubConfigService } from '../config/stub-config.service';
import { DEFAULT_SCENARIO_MODE, SCENARIO_MODE } from './scenario.constants';
import type { IScenarioState } from './scenario.interfaces';
import type { ScenarioMode } from './scenario.type';

@Injectable()
export class ScenarioService {
  private mode: ScenarioMode = DEFAULT_SCENARIO_MODE;

  private remaining: number | null = null;

  constructor(private readonly config: StubConfigService) {}

  setForced(mode: ScenarioMode, times: number | null): void {
    this.mode = mode;
    this.remaining = times;
  }

  next(): ScenarioMode {
    if (this.mode !== SCENARIO_MODE.NORMAL) {
      const resolved = this.mode;

      if (this.remaining !== null) {
        this.remaining -= 1;

        if (this.remaining <= 0) {
          this.mode = DEFAULT_SCENARIO_MODE;
          this.remaining = null;
        }
      }

      return resolved;
    }

    return this.drawNormal();
  }

  state(): IScenarioState {
    return { mode: this.mode, remaining: this.remaining };
  }

  reset(): void {
    this.mode = DEFAULT_SCENARIO_MODE;
    this.remaining = null;
  }

  // Fixed draw order (timeout -> error_5xx -> slow -> ok) is load-bearing:
  // with all rates 0 the result is always 'ok', which CI relies on for determinism.
  private drawNormal(): ScenarioMode {
    const { timeoutRate, failRate, slowRate } = this.config.get();

    if (Math.random() < timeoutRate) {
      return SCENARIO_MODE.TIMEOUT;
    }

    if (Math.random() < failRate) {
      return SCENARIO_MODE.ERROR_5XX;
    }

    if (Math.random() < slowRate) {
      return SCENARIO_MODE.SLOW;
    }

    return SCENARIO_MODE.OK;
  }
}
