import { Controller, Get, Res } from '@nestjs/common';
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

  // Ответ отправляется вручную (@Res без passthrough), а не через @HttpCode + res.status():
  // при passthrough Nest после хендлера ещё раз зовёт reply(res, body, httpStatusCode), и то,
  // переживёт ли ручной 503 этот вызов, зависит от того, доедет ли httpStatusCode до замыкания
  // handleResponse — недокументированная деталь ядра. Код ответа readiness-пробы слишком дорог,
  // чтобы зависеть от неё.
  @Get('ready')
  async ready(@Res() res: Response): Promise<void> {
    const { status, components } = await this.registry.check();
    const body: IReadinessResponse = { status, ...components };
    const httpStatus = status === 'degraded' ? READINESS_DEGRADED_STATUS : READINESS_OK_STATUS;

    res.status(httpStatus).json(body);
  }
}
