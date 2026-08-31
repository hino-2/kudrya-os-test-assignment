import type { ReadinessStatus } from './health.type';

export interface IReadinessCheckResult {
  status: ReadinessStatus;
  components: Record<string, string>;
}

export interface IHealthResponse {
  status: 'ok';
  service: string;
  version: string;
  uptime_s: number;
}

export interface IReadinessProbeResult {
  healthy: boolean;
  detail: string;
}

export interface IReadinessResponse {
  status: ReadinessStatus;
  [component: string]: string;
}
