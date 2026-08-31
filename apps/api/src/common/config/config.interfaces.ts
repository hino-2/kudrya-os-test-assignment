import type { LogFormat, LogLevel } from '../logging/logging.type';
import type { EnvCrossRuleCheck, EnvVarKind, EnvVarName, NodeEnvName } from './config.type';

export interface IEnvVarSpec {
  name: EnvVarName;
  kind: EnvVarKind;
  required?: boolean;
  default?: string | number | boolean;
  min?: number;
  max?: number;
  values?: readonly string[];
  protocols?: readonly string[];
  allowEmpty?: boolean;
}

export interface IEnvIssue {
  name: string;
  reason: string;
}

export interface IEnvCrossRule {
  fields: readonly EnvVarName[];
  check: EnvCrossRuleCheck;
}

export interface IHttpConfig {
  port: number;
  nodeEnv: NodeEnvName;
  isTest: boolean;
  isProduction: boolean;
}

export interface IDbConfig {
  url: string;
  poolSize: number;
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  txRetryAttempts: number;
}

export interface ILoggingConfig {
  level: LogLevel;
  format: LogFormat;
  includeStack: boolean;
}

export interface ISupplierConfig {
  aBaseUrl: string;
  bBaseUrl: string;
  requestTimeoutMs: number;
  maxAttemptsPerSupplier: number;
  unknownMaxResolveAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  jobBudgetMs: number;
  virtualStock: number;
}

export interface IJobConfig {
  workerEnabled: boolean;
  workerId: string;
  pollIntervalMs: number;
  batchSize: number;
  maxAttempts: number;
  retryBaseMs: number;
  retryMaxMs: number;
  lockTtlMs: number;
}

export interface ISweeperConfig {
  enabled: boolean;
  intervalMs: number;
  batchSize: number;
  stuckOrderAgeSeconds: number;
  deliveryFailedRetrySeconds: number;
  maxDeliveryGenerations: number;
  attemptInflightTimeoutMs: number;
  orphanTtlSeconds: number;
  stockReconcileIntervalMs: number;
}

export interface IAdminConfig {
  enabled: boolean;
  token: string;
  guardDisabled: boolean;
}

export interface ICatalogConfig {
  defaultLimit: number;
  maxLimit: number;
}
