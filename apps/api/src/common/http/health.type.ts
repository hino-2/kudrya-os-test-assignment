import type { IReadinessProbeResult } from './health.interfaces';
import type { READINESS_COMPONENT } from './http.constants';

export type ReadinessComponent = (typeof READINESS_COMPONENT)[keyof typeof READINESS_COMPONENT];

export type ReadinessStatus = 'ok' | 'degraded';

export type ReadinessProbe = () => Promise<IReadinessProbeResult>;
