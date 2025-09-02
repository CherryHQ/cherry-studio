import electronConfigPrettier from '@electron-toolkit/eslint-config-prettier'
import eslint from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import tsParser from '@typescript-eslint/parser'
import importPlugin from 'eslint-plugin-import'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'
import * as espree from 'espree'
import tseslint from 'typescript-eslint'
import globals from 'globals'

const i18nPlugin = {
  rules: {
    'no-template-in-t': {
      meta: {
        type: 'problem',
        docs: {
          description: '⚠️不建议在 t() 函数中使用模板字符串，这样会导致渲染结果不可预料',
          recommended: true
        },
        messages: {
          noTemplateInT: '⚠️不建议在 t() 函数中使用模板字符串，这样会导致渲染结果不可预料'
        }
      },
      create(context) {
        return {
          CallExpression(node) {
            const { callee, arguments: args } = node
            const isTFunction =
              (callee.type === 'Identifier' && callee.name === 't') ||
              (callee.type === 'MemberExpression' &&
                callee.property.type === 'Identifier' &&
                callee.property.name === 't')

            if (isTFunction && args[0]?.type === 'TemplateLiteral') {
              context.report({
                node: args[0],
                messageId: 'noTemplateInT'
              })
            }
          }
        }
      }
    }
  }
}

export default tseslint.config([
  eslint.configs.recommended,
  electronConfigPrettier,
  eslintReact.configs['recommended-typescript'],
  reactHooks.configs['recommended-latest'],
  // js eslint. I really don't know why so many types
  {
    files: ['scripts/*.js', 'resources/scripts/*.js'],
    languageOptions: {
      parser: espree,
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: globals.node
    }
  },
  {
    files: ['eslint.config.mjs'],
    languageOptions: {
      parser: espree,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.node
    }
  },
  {
    files: ['resources/js/*.js'],
    languageOptions: {
      parser: espree,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser
    }
  },
  // ts eslint
  {
    files: ['**/*.{ts,tsx}'],
    ignores: ['**/*.{js,mjs}', 'vitest.config.ts', 'playwright.config.ts', 'electron.vite.config.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true
        }
      }
    },
    plugins: {
      i18n: i18nPlugin,
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
      import: importPlugin
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports' // 要求写成 import type { ... }
        }
      ],
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { caughtErrors: 'none' }],
      '@typescript-eslint/no-unused-expressions': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/ban-ts-comment': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/no-unsafe-argument': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/no-unsafe-member-access': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/restrict-template-expressions': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/no-unsafe-call': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/no-unsafe-return': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/no-redundant-type-constituents': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/require-await': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/no-floating-promises': 'off', // temporally. it's recommended by tseslint but too many errors
      '@typescript-eslint/no-misused-promises': 'off', // temporally. it's recommended by tseslint but too many errors
      'import/no-cycle': 'error',
      'import/no-duplicates': 'error',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'unused-imports/no-unused-imports': 'error',
      '@eslint-react/no-prop-types': 'error',
      'prettier/prettier': ['error'],
      'i18n/no-template-in-t': 'warn'
    },
    settings: {
      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx']
      },
      'import/resolver': {
        typescript: {
          project: './tsconfig.json'
        }
      }
    },
    extends: [tseslint.configs.recommendedTypeChecked]
  },
  // simple lint for config ts file
  {
    files: ['vitest.config.ts', 'playwright.config.ts', 'electron.vite.config.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        projectService: false,
        ecmaVersion: 2022,
        sourceType: 'module'
      },
      globals: globals.node
    }
  },
  // Configuration for ensuring compatibility with the original ESLint(8.x) rules
  {
    rules: {
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
  },
  // LoggerService Custom Rules - only apply to src directory
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['src/**/__tests__/**', 'src/**/__mocks__/**', 'src/**/*.test.*'],
    rules: {
      'no-restricted-syntax': [
        process.env.PRCI ? 'error' : 'warn',
        {
          selector: 'CallExpression[callee.object.name="console"]',
          message:
            '❗CherryStudio uses unified LoggerService: 📖 docs/technical/how-to-use-logger-en.md\n❗CherryStudio 使用统一的日志服务：📖 docs/technical/how-to-use-logger-zh.md\n\n'
        }
      ]
    }
  },
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'packages/**/dist',
      'out/**',
      'local/**',
      '.yarn/**',
      '.gitignore',
      'scripts/cloudflare-worker.js',
      'src/main/integration/nutstore/sso/lib/**',
      'src/main/integration/cherryin/index.js'
    ]
  }
])
