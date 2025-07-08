import electronConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import tseslint from '@electron-toolkit/eslint-config-ts'
import eslint from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import { defineConfig } from 'eslint/config'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'

export default defineConfig([
  eslint.configs.recommended,
  tseslint.configs.recommended,
  electronConfigPrettier,
  eslintReact.configs['recommended-typescript'],
  reactHooks.configs['recommended-latest'],
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'unused-imports/no-unused-imports': 'error',
      '@eslint-react/no-prop-types': 'error',
      'prettier/prettier': ['error']
    }
  },
  // Configuration for ensuring compatibility with the original ESLint(8.x) rules
  ...[
    {
      rules: {
        '@typescript-eslint/no-require-imports': 'off',
        '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
        '@typescript-eslint/no-unused-expressions': 'off',
        '@typescript-eslint/no-empty-object-type': 'off',
        '@eslint-react/hooks-extra/no-direct-set-state-in-use-effect': 'off',
        '@eslint-react/web-api/no-leaked-event-listener': 'off',
        '@eslint-react/web-api/no-leaked-timeout': 'off',
        '@eslint-react/no-unknown-property': 'off',
        '@eslint-react/no-nested-component-definitions': 'off',
        '@eslint-react/dom/no-dangerously-set-innerhtml': 'off',
        '@eslint-react/no-array-index-key': 'off',
        '@eslint-react/no-unstable-default-props': 'off',
        '@eslint-react/no-unstable-context-value': 'off',
        '@eslint-react/hooks-extra/prefer-use-state-lazy-initialization': 'off',
        '@eslint-react/hooks-extra/no-unnecessary-use-prefix': 'off',
        '@eslint-react/no-children-to-array': 'off'
      }
    }
  ],
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'out/**',
      'local/**',
      '.yarn/**',
      '.gitignore',
      'scripts/cloudflare-worker.js',
      'src/main/integration/nutstore/sso/lib/**'
    ]
  }
])
