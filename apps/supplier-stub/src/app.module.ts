import { Module } from '@nestjs/common';

import { StubConfigModule } from './config/stub-config.module';
import { StubLogger } from './common/logging/stub-logger.service';
import { ControlController } from './control/control.controller';
import { HealthController } from './health/health.controller';
import { IssueController } from './issue/issue.controller';
import { IssueService } from './issue/issue.service';
import { ScenarioService } from './scenario/scenario.service';
import { StubStateStore } from './persistence/stub-state.store';

@Module({
  imports: [StubConfigModule],
  controllers: [IssueController, ControlController, HealthController],
  providers: [ScenarioService, StubStateStore, StubLogger, IssueService],
})
export class AppModule {}
