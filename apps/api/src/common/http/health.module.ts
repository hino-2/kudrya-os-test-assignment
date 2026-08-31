import { Global, Module } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { HealthController } from './health.controller';
import { READINESS_COMPONENT, READINESS_QUERY } from './http.constants';
import { ReadinessRegistry } from './readiness.registry';

@Global()
@Module({
  controllers: [HealthController],
  providers: [ReadinessRegistry],
  exports: [ReadinessRegistry],
})
export class HealthModule implements OnModuleInit {
  constructor(
    private readonly registry: ReadinessRegistry,
    private readonly dataSource: DataSource,
  ) {}

  onModuleInit(): void {
    this.registry.register(READINESS_COMPONENT.DB, async () => {
      await this.dataSource.query(READINESS_QUERY);

      return { healthy: true, detail: 'ok' };
    });
  }
}
