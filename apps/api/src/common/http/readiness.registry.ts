import { Injectable } from '@nestjs/common';

import type { IReadinessCheckResult, IReadinessProbeResult } from './health.interfaces';
import type { ReadinessComponent, ReadinessProbe } from './health.type';

@Injectable()
export class ReadinessRegistry {
  private readonly probes = new Map<ReadinessComponent, ReadinessProbe>();

  register(component: ReadinessComponent, probe: ReadinessProbe): void {
    this.probes.set(component, probe);
  }

  async check(): Promise<IReadinessCheckResult> {
    const entries = await Promise.all(
      [...this.probes.entries()].map(async ([component, probe]) => {
        const result = await this.runProbe(probe);

        return [component, result] as const;
      }),
    );

    const components: Record<string, string> = {};
    let healthy = true;

    for (const [component, result] of entries) {
      components[component] = result.detail;

      if (!result.healthy) {
        healthy = false;
      }
    }

    return { status: healthy ? 'ok' : 'degraded', components };
  }

  private async runProbe(probe: ReadinessProbe): Promise<IReadinessProbeResult> {
    try {
      return await probe();
    } catch {
      return { healthy: false, detail: 'error' };
    }
  }
}
