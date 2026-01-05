import tseslint from '@electron-toolkit/eslint-config-ts'
import eslint from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import { defineConfig } from 'eslint/config'
import importZod from 'eslint-plugin-import-zod'
import oxlint from 'eslint-plugin-oxlint'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'

export default defineConfig([
  eslint.configs.recommended,
  tseslint.configs.recommended,
  eslintReact.configs['recommended-typescript'],
  reactHooks.configs['recommended-latest'],
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
      'unused-imports': unusedImports,
      'import-zod': importZod
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'off',
      'simple-import-sort/imports': 'error',
      'simple-import-sort/exports': 'error',
      'unused-imports/no-unused-imports': 'error',
      '@eslint-react/no-prop-types': 'error',
      'import-zod/prefer-zod-namespace': 'error'
    }
  },
  // Configuration for ensuring compatibility with the original ESLint(8.x) rules
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
  },
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'dist/**',
      'out/**',
      'local/**',
      'tests/**',
      '.yarn/**',
      '.gitignore',
      '.conductor/**',
      'scripts/cloudflare-worker.js',
      'src/main/integration/nutstore/sso/lib/**',
      'src/main/integration/cherryai/index.js',
      'src/main/integration/nutstore/sso/lib/**',
      'src/renderer/src/ui/**',
      'packages/**/dist'
    ]
  },
  // turn off oxlint supported rules.
  ...oxlint.configs['flat/eslint'],
  ...oxlint.configs['flat/typescript'],
  ...oxlint.configs['flat/unicorn'],
  // Custom rules should be after oxlint to overwrite
  // LoggerService Custom Rules - only apply to src directory
  {
    files: ['src/**/*.{ts,tsx,js,jsx}'],
    ignores: ['src/**/__tests__/**', 'src/**/__mocks__/**', 'src/**/*.test.*', 'src/preload/**'],
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
  // i18n
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module'
    },
    plugins: {
      i18n: {
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
    },
    rules: {
      'i18n/no-template-in-t': 'warn'
    }
  },
  // ui migration
  {
    // Component Rules - prevent importing antd components when migration completed
    files: ['**/*.{ts,tsx,js,jsx}'],
    ignores: [],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // {
            //   name: 'antd',
            //   importNames: ['Flex', 'Switch', 'message', 'Button', 'Tooltip'],
            //   message:
            //     '❌ Do not import this component from antd. Use our custom components instead: import { ... } from "@cherrystudio/ui"'
            // },
            {
              name: 'antd',
              importNames: ['Switch'],
              message:
                '❌ Do not import this component from antd. Use our custom components instead: import { ... } from "@cherrystudio/ui"'
            },
            {
              name: '@heroui/react',
              importNames: ['Switch'],
              message:
                '❌ Do not import the component from heroui directly. It\'s deprecated.'
            }
          ]
        }
      ]
    }
  },
  // Schema key naming convention (cache & preferences)
  // Supports both fixed keys and template keys:
  // - Fixed: 'app.user.avatar', 'chat.multi_select_mode'
  // - Template: 'scroll.position:${topicId}', 'cache:${type}:${id}'
  {
    files: ['packages/shared/data/cache/cacheSchemas.ts', 'packages/shared/data/preference/preferenceSchemas.ts'],
    plugins: {
      'data-schema-key': {
        rules: {
          'valid-key': {
            meta: {
              type: 'problem',
              docs: {
                description:
                  'Enforce schema key naming convention: namespace.sub.key_name or namespace.key:${variable}',
                recommended: true
              },
              messages: {
                invalidKey:
                  'Schema key "{{key}}" must follow format: namespace.sub.key_name (e.g., app.user.avatar) or with template: namespace.key:${variable} (e.g., scroll.position:${id}).',
                invalidTemplateVar:
                  'Template variable in "{{key}}" must be a valid identifier (e.g., ${id}, ${topicId}).'
              }
            },
            create(context) {
              /**
               * Validates a schema key for correct naming convention.
               *
               * Supports two formats:
               * 1. Fixed keys: lowercase segments separated by dots
               *    Example: 'app.user.avatar', 'chat.multi_select_mode'
               *
               * 2. Template keys: fixed prefix + template placeholders
               *    Example: 'scroll.position:${id}', 'cache:${type}:${id}'
               *
               * Template placeholder rules:
               * - Must use ${variableName} syntax
               * - Variable name must be valid identifier (start with letter, alphanumeric + underscore)
               * - Empty placeholders like ${} are invalid
               *
               * @param {string} key - The schema key to validate
               * @returns {{ valid: boolean, error?: 'invalidKey' | 'invalidTemplateVar' }}
               */
              function validateKey(key) {
                // Check if key contains template placeholders
                const hasTemplate = key.includes('${')

                if (hasTemplate) {
                  // Template key validation
                  // Must have at least one dot-separated segment before any template or colon
                  // Example valid: 'scroll.position:${id}', 'cache:${type}:${id}'
                  // Example invalid: '${id}', ':${id}'

                  // Extract and validate all template variables
                  const templateVarPattern = /\$\{([^}]*)\}/g
                  let match
                  while ((match = templateVarPattern.exec(key)) !== null) {
                    const varName = match[1]
                    // Variable must be a valid identifier: start with letter, contain only alphanumeric and underscore
                    if (!varName || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(varName)) {
                      return { valid: false, error: 'invalidTemplateVar' }
                    }
                  }

                  // Replace template placeholders with a marker to validate the structure
                  const keyWithoutTemplates = key.replace(/\$\{[^}]+\}/g, '__TEMPLATE__')

                  // Template key structure:
                  // - Must start with a valid segment (lowercase letters, numbers, underscores)
                  // - Segments separated by dots or colons
                  // - Must have at least one dot-separated segment
                  // - Can end with template placeholder
                  const templateKeyPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*(:[a-z0-9_]*|:__TEMPLATE__)*$/

                  if (!templateKeyPattern.test(keyWithoutTemplates)) {
                    return { valid: false, error: 'invalidKey' }
                  }

                  return { valid: true }
                } else {
                  // Fixed key validation: standard dot-separated format
                  const fixedKeyPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
                  if (!fixedKeyPattern.test(key)) {
                    return { valid: false, error: 'invalidKey' }
                  }
                  return { valid: true }
                }
              }

              return {
                TSPropertySignature(node) {
                  if (node.key.type === 'Literal' && typeof node.key.value === 'string') {
                    const key = node.key.value
                    const result = validateKey(key)
                    if (!result.valid) {
                      context.report({
                        node: node.key,
                        messageId: result.error,
                        data: { key }
                      })
                    }
                  }
                },
                Property(node) {
                  if (node.key.type === 'Literal' && typeof node.key.value === 'string') {
                    const key = node.key.value
                    const result = validateKey(key)
                    if (!result.valid) {
                      context.report({
                        node: node.key,
                        messageId: result.error,
                        data: { key }
                      })
                    }
                  }
                }
              }
            }
          }
        }
      }
    },
    rules: {
      'data-schema-key/valid-key': 'error'
    }
  }
])
