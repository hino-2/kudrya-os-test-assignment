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
    ],
  },
});
