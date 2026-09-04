import { applyTestEnv } from './test-env.helper';

applyTestEnv();

// та же причина, что в env.setup.worker-enabled.ts: AppModule кэширует NestConfigModule.forRoot()
// на уровне статических метаданных класса при первом импорте в процессе — startApi(envOverrides)
// внутри самого теста приходит слишком поздно. Пороги свипера форсируются здесь, ДО импорта
// AppModule тестовым файлом, в собственном vitest-проекте ("integration-sweeper"), чтобы не сбивать
// пороги по умолчанию у остальных интеграционных сьютов.
process.env.SWEEPER_ENABLED = 'false';
process.env.JOB_LOCK_TTL_MS = '1000';
process.env.STUCK_ORDER_AGE_SECONDS = '1';
process.env.DELIVERY_FAILED_RETRY_SECONDS = '1';
process.env.MAX_DELIVERY_GENERATIONS = '3';
process.env.ATTEMPT_INFLIGHT_TIMEOUT_MS = '1000';
process.env.ORPHAN_TTL_SECONDS = '1';
