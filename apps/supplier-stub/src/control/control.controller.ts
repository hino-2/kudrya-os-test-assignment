import { Body, Controller, Get, NotFoundException, Post } from '@nestjs/common';

import { StubConfigService } from '../config/stub-config.service';
import { StubLogger } from '../common/logging/stub-logger.service';
import { IssueService } from '../issue/issue.service';
import { ScenarioService } from '../scenario/scenario.service';
import { StubStateStore } from '../persistence/stub-state.store';
import { CONTROL_LOG_EVENT } from './control.constants';
import { ControlRestockDto } from './dto/control-restock.dto';
import { ControlScenarioDto } from './dto/control-scenario.dto';
import type { IControlStateResponse } from './control.interfaces';

@Controller('_control')
export class ControlController {
  constructor(
    private readonly config: StubConfigService,
    private readonly scenario: ScenarioService,
    private readonly store: StubStateStore,
    private readonly issueService: IssueService,
    private readonly logger: StubLogger,
  ) {}

  @Post('scenario')
  setScenario(@Body() dto: ControlScenarioDto): IControlStateResponse {
    this.assertEnabled();
    this.scenario.setForced(dto.mode, dto.times ?? null);
    this.logger.write({
      level: 'info',
      event: CONTROL_LOG_EVENT.SCENARIO_SET,
      data: { mode: dto.mode, times: dto.times ?? null },
    });

    return this.state();
  }

  @Post('restock')
  restock(@Body() dto: ControlRestockDto): IControlStateResponse {
    this.assertEnabled();
    this.store.restock(dto.count);
    this.logger.write({
      level: 'info',
      event: CONTROL_LOG_EVENT.RESTOCK,
      data: { count: dto.count },
    });

    return this.state();
  }

  @Post('reset')
  reset(): IControlStateResponse {
    this.assertEnabled();
    this.scenario.reset();
    this.store.reset();
    this.logger.write({ level: 'info', event: CONTROL_LOG_EVENT.RESET });

    return this.state();
  }

  @Get('state')
  getState(): IControlStateResponse {
    this.assertEnabled();

    return this.state();
  }

  private state(): IControlStateResponse {
    return {
      scenario: this.scenario.state(),
      inventory: this.issueService.inventory(),
      issuedCount: this.store.snapshot().issued.length,
    };
  }

  private assertEnabled(): void {
    if (!this.config.get().controlEnabled) {
      throw new NotFoundException();
    }
  }
}
