import { Controller, Get } from '@nestjs/common';

import { StubConfigService } from '../config/stub-config.service';
import { StubStateStore } from '../persistence/stub-state.store';
import type { IHealthResponse } from './health.interfaces';

@Controller('health')
export class HealthController {
  constructor(
    private readonly config: StubConfigService,
    private readonly store: StubStateStore,
  ) {}

  @Get()
  health(): IHealthResponse {
    return {
      status: 'ok',
      supplierId: this.config.get().supplierId,
      remaining: this.store.remaining(),
    };
  }
}
