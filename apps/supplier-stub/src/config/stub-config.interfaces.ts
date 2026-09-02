import type { SupplierId } from './stub-config.type';

export interface IStubConfig {
  supplierId: SupplierId;
  port: number;
  inventorySize: number;
  failRate: number;
  timeoutRate: number;
  slowRate: number;
  latencyMinMs: number;
  latencyMaxMs: number;
  hangMs: number;
  persistPath: string | null;
  controlEnabled: boolean;
  logLevel: string;
  logFormat: string;
}

export interface IEnvIssue {
  name: string;
  reason: string;
}
