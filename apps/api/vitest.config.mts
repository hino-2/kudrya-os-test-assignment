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
    ],
  },
});
