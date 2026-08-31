import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [swc.vite()],
  test: {
    passWithNoTests: true,
    include: ['test/**/*.spec.ts'],
  },
});
