import { Controller, Get, HttpCode, Res } from '@nestjs/common';
import type { Response } from 'express';

import type { IHealthResponse, IReadinessResponse } from './health.interfaces';
import { APP_VERSION, HEALTH_ROUTE, READINESS_DEGRADED_STATUS, READINESS_OK_STATUS, SERVICE_NAME } from './http.constants';
import { ReadinessRegistry } from './readiness.registry';

@Controller(HEALTH_ROUTE)
export class HealthController {
  constructor(private readonly registry: ReadinessRegistry) {}

  @Get()
  live(): IHealthResponse {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: APP_VERSION,
      uptime_s: Math.floor(process.uptime()),
    };
  }

  @Get('ready')
  @HttpCode(READINESS_OK_STATUS)
  async ready(@Res({ passthrough: true }) res: Response): Promise<IReadinessResponse> {
    const { status, components } = await this.registry.check();

    if (status === 'degraded') {
      res.status(READINESS_DEGRADED_STATUS);
    }

    return { status, ...components };
  }
}
