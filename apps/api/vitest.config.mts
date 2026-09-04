import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    passWithNoTests: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['test/unit/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: ['test/integration/**/*.e2e.spec.ts'],
          globalSetup: ['./test/helpers/global.setup.ts'],
          setupFiles: ['./test/helpers/env.setup.ts'],
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          // отдельный проект: WORKER_ENABLED форсируется в setupFiles до импорта AppModule
          // (см. env.setup.worker-enabled.ts) — Nest кэширует ConfigModule.forRoot() на уровне
          // статических метаданных класса, поэтому этот файл не может жить в проекте "integration"
          // и переопределять env через envOverrides в самом тесте
          name: 'integration-worker',
          include: ['test/integration/**/*.worker.spec.ts'],
          globalSetup: ['./test/helpers/global.setup.ts'],
          setupFiles: ['./test/helpers/env.setup.worker-enabled.ts'],
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          // тот же довод, что у "integration-worker": пороги свипера форсируются в setupFiles
          // до импорта AppModule (см. env.setup.sweeper.ts)
          name: 'integration-sweeper',
          include: ['test/integration/**/*.sweeper.spec.ts'],
          globalSetup: ['./test/helpers/global.setup.ts'],
          setupFiles: ['./test/helpers/env.setup.sweeper.ts'],
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          // тот же довод: ADMIN_API_ENABLED=false форсируется в setupFiles до импорта AppModule
          // (см. env.setup.admin-disabled.ts)
          name: 'integration-admin-disabled',
          include: ['test/integration/**/*.admin-disabled.spec.ts'],
          globalSetup: ['./test/helpers/global.setup.ts'],
          setupFiles: ['./test/helpers/env.setup.admin-disabled.ts'],
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          // тот же довод: пустой ADMIN_TOKEN форсируется в setupFiles до импорта AppModule
          // (см. env.setup.admin-open.ts)
          name: 'integration-admin-open',
          include: ['test/integration/**/*.admin-open.spec.ts'],
          globalSetup: ['./test/helpers/global.setup.ts'],
          setupFiles: ['./test/helpers/env.setup.admin-open.ts'],
          fileParallelism: false,
          testTimeout: 30000,
        },
      },
    ],
  },
});
