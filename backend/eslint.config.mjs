// @ts-check
import eslint from '@eslint/js';
import boundaries from 'eslint-plugin-boundaries';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    plugins: {
      boundaries,
    },
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: {
      'boundaries/elements': [
        { type: 'controller', pattern: 'src/**/*.controller.ts' },
        { type: 'service', pattern: 'src/**/*.service.ts' },
        { type: 'provider', pattern: 'src/**/providers/**/*.ts' },
        { type: 'dto', pattern: 'src/**/dto/**/*.ts' },
        { type: 'shared', pattern: 'src/shared/**' },
        { type: 'infra', pattern: 'src/prisma/**' },
      ],
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
      'boundaries/element-types': [
        'error',
        {
          default: 'allow',
          message: 'Layer violation: {{from}} cannot import from {{dependency}}',
          rules: [
            {
              from: 'controller',
              allow: ['controller', 'service', 'shared', 'dto'],
            },
            {
              from: 'service',
              allow: ['service', 'provider', 'shared', 'dto', 'infra'],
            },
            {
              from: 'provider',
              allow: ['provider', 'shared', 'infra'],
            },
            {
              from: 'dto',
              allow: ['dto', 'shared'],
            },
            {
              from: 'shared',
              allow: ['shared'],
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.spec.ts', 'src/**/*.e2e-spec.ts', 'test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
