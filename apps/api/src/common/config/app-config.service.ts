import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  IAdminConfig,
  ICatalogConfig,
  IDbConfig,
  IHttpConfig,
  IJobConfig,
  ILoggingConfig,
  ISupplierConfig,
  ISweeperConfig,
} from './config.interfaces';
import type { AppEnv } from './config.type';

@Injectable()
export class AppConfigService {
  private readonly httpConfig: IHttpConfig;
  private readonly dbConfig: IDbConfig;
  private readonly loggingConfig: ILoggingConfig;
  private readonly supplierConfig: ISupplierConfig;
  private readonly jobConfig: IJobConfig;
  private readonly sweeperConfig: ISweeperConfig;
  private readonly adminConfig: IAdminConfig;
  private readonly catalogConfig: ICatalogConfig;

  constructor(configService: ConfigService<AppEnv, true>) {
    const nodeEnv = configService.get('NODE_ENV', { infer: true });
    const adminToken = configService.get('ADMIN_TOKEN', { infer: true });

    this.httpConfig = Object.freeze({
      port: configService.get('PORT', { infer: true }),
      nodeEnv,
      isTest: nodeEnv === 'test',
      isProduction: nodeEnv === 'production',
    });

    this.dbConfig = Object.freeze({
      url: configService.get('DATABASE_URL', { infer: true }),
      poolSize: configService.get('DB_POOL_SIZE', { infer: true }),
      statementTimeoutMs: configService.get('DB_STATEMENT_TIMEOUT_MS', { infer: true }),
      lockTimeoutMs: configService.get('DB_LOCK_TIMEOUT_MS', { infer: true }),
      txRetryAttempts: configService.get('DB_TX_RETRY_ATTEMPTS', { infer: true }),
    });

    this.loggingConfig = Object.freeze({
      level: configService.get('LOG_LEVEL', { infer: true }),
      format: configService.get('LOG_FORMAT', { infer: true }),
      includeStack: configService.get('LOG_STACK', { infer: true }),
    });

    this.supplierConfig = Object.freeze({
      aBaseUrl: configService.get('SUPPLIER_A_BASE_URL', { infer: true }),
      bBaseUrl: configService.get('SUPPLIER_B_BASE_URL', { infer: true }),
      requestTimeoutMs: configService.get('SUPPLIER_REQUEST_TIMEOUT_MS', { infer: true }),
      maxAttemptsPerSupplier: configService.get('SUPPLIER_MAX_ATTEMPTS_PER_SUPPLIER', { infer: true }),
      unknownMaxResolveAttempts: configService.get('SUPPLIER_UNKNOWN_MAX_RESOLVE_ATTEMPTS', { infer: true }),
      retryBaseMs: configService.get('SUPPLIER_RETRY_BASE_MS', { infer: true }),
      retryMaxMs: configService.get('SUPPLIER_RETRY_MAX_MS', { infer: true }),
      jobBudgetMs: configService.get('SUPPLIER_JOB_BUDGET_MS', { infer: true }),
      virtualStock: configService.get('SUPPLIER_VIRTUAL_STOCK', { infer: true }),
    });

    this.jobConfig = Object.freeze({
      workerEnabled: configService.get('WORKER_ENABLED', { infer: true }),
      workerId: configService.get('WORKER_ID', { infer: true }),
      pollIntervalMs: configService.get('JOB_POLL_INTERVAL_MS', { infer: true }),
      batchSize: configService.get('JOB_BATCH_SIZE', { infer: true }),
      maxAttempts: configService.get('JOB_MAX_ATTEMPTS', { infer: true }),
      retryBaseMs: configService.get('JOB_RETRY_BASE_MS', { infer: true }),
      retryMaxMs: configService.get('JOB_RETRY_MAX_MS', { infer: true }),
      lockTtlMs: configService.get('JOB_LOCK_TTL_MS', { infer: true }),
    });

    this.sweeperConfig = Object.freeze({
      enabled: configService.get('SWEEPER_ENABLED', { infer: true }),
      intervalMs: configService.get('SWEEPER_INTERVAL_MS', { infer: true }),
      batchSize: configService.get('SWEEPER_BATCH_SIZE', { infer: true }),
      stuckOrderAgeSeconds: configService.get('STUCK_ORDER_AGE_SECONDS', { infer: true }),
      deliveryFailedRetrySeconds: configService.get('DELIVERY_FAILED_RETRY_SECONDS', { infer: true }),
      maxDeliveryGenerations: configService.get('MAX_DELIVERY_GENERATIONS', { infer: true }),
      attemptInflightTimeoutMs: configService.get('ATTEMPT_INFLIGHT_TIMEOUT_MS', { infer: true }),
      orphanTtlSeconds: configService.get('ORPHAN_TTL_SECONDS', { infer: true }),
      stockReconcileIntervalMs: configService.get('STOCK_RECONCILE_INTERVAL_MS', { infer: true }),
    });

    this.adminConfig = Object.freeze({
      enabled: configService.get('ADMIN_API_ENABLED', { infer: true }),
      token: adminToken,
      guardDisabled: adminToken === '',
    });

    this.catalogConfig = Object.freeze({
      defaultLimit: configService.get('CATALOG_DEFAULT_LIMIT', { infer: true }),
      maxLimit: configService.get('CATALOG_MAX_LIMIT', { infer: true }),
    });
  }

  get http(): IHttpConfig {
    return this.httpConfig;
  }

  get db(): IDbConfig {
    return this.dbConfig;
  }

  get logging(): ILoggingConfig {
    return this.loggingConfig;
  }

  get supplier(): ISupplierConfig {
    return this.supplierConfig;
  }

  get jobs(): IJobConfig {
    return this.jobConfig;
  }

  get sweeper(): ISweeperConfig {
    return this.sweeperConfig;
  }

  get admin(): IAdminConfig {
    return this.adminConfig;
  }

  get catalog(): ICatalogConfig {
    return this.catalogConfig;
  }
}
