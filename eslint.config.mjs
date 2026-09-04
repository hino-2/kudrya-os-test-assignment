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
    ignores: [
      '**/dist/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.stub-state-*.json',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        sourceType: 'module',
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
