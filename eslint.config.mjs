import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

const noRestrictedProcessEnv = {
  'no-restricted-properties': [
    'error',
    {
      object: 'process',
      property: 'env',
      message: 'Use AppConfigService / typed config getters instead of process.env directly.',
    },
  ],
};

export default tseslint.config(
  {
    ignores: ['**/dist/**', '**/coverage/**', '**/node_modules/**', '**/.stub-state-*.json'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
        // projectService сам подбирает tsconfig по расположению файла: у apps/api,
        // apps/supplier-stub и tools свои tsconfig.json, каждый из которых уже включает
        // и src/**, и test/**, и vitest.config.mts
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...noRestrictedProcessEnv,
      'padding-line-between-statements': [
        'error',
        { blankLine: 'always', prev: 'block-like', next: '*' },
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
      ],
    },
  },
  {
    // сам конфиг eslint не покрыт ни одним tsconfig — type-aware правилам его не отдаём
    files: ['eslint.config.mjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    files: [
      'apps/api/src/common/config/env.validation.ts',
      'apps/api/test/helpers/test-env.helper.ts',
      'apps/api/test/helpers/app.harness.ts',
      'apps/api/test/helpers/stub.harness.ts',
      'apps/api/test/helpers/env.setup.worker-enabled.ts',
      'apps/api/test/helpers/env.setup.sweeper.ts',
      'apps/api/test/helpers/env.setup.admin-disabled.ts',
      'apps/api/test/helpers/env.setup.admin-open.ts',
      'apps/supplier-stub/src/main.ts',
      'apps/supplier-stub/src/**/*.config.ts',
      'tools/**/*.ts',
      '**/*.config.*',
      '**/data-source.ts',
    ],
    rules: {
      'no-restricted-properties': 'off',
    },
  },
  eslintConfigPrettier,
);
