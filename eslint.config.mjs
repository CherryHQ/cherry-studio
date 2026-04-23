import tseslint from '@electron-toolkit/eslint-config-ts'
import eslint from '@eslint/js'
import eslintReact from '@eslint-react/eslint-plugin'
import { defineConfig } from 'eslint/config'
import importZod from 'eslint-plugin-import-zod'
import oxlint from 'eslint-plugin-oxlint'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import unusedImports from 'eslint-plugin-unused-imports'

const LEGACY_RENDERER_CSS_VARS = [
  '--color-text-1',
  '--color-text-2',
  '--color-text-3',
  '--color-text',
  '--color-text-secondary',
  '--color-text-soft',
  '--color-text-light',
  '--color-background-soft',
  '--color-background-mute',
  '--color-background-opacity',
  '--color-border-soft',
  '--color-border-mute',
  '--color-error',
  '--color-link',
  '--color-primary-bg',
  '--color-fill-secondary',
  '--color-fill-2',
  '--color-bg-base',
  '--color-bg-1',
  '--color-code-background',
  '--color-inline-code-background',
  '--color-inline-code-text',
  '--color-hover',
  '--color-active',
  '--color-frame-border',
  '--color-group-background',
  '--color-reference',
  '--color-reference-text',
  '--color-reference-background',
  '--color-list-item',
  '--color-list-item-hover',
  '--color-highlight',
  '--color-background-highlight',
  '--color-background-highlight-accent',
  '--navbar-background-mac',
  '--navbar-background',
  '--modal-background',
  '--chat-background',
  '--chat-background-user',
  '--chat-background-assistant',
  '--chat-text-user',
  '--list-item-border-radius',
  '--color-gray-1',
  '--color-gray-2',
  '--color-gray-3',
  '--color-icon-white',
  '--color-primary-1',
  '--color-primary-6',
  '--color-status-success',
  '--color-status-error',
  '--color-status-warning'
]

const LEGACY_RENDERER_CSS_VAR_REGEX = new RegExp(
  `(${LEGACY_RENDERER_CSS_VARS.map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?![\\w-])`,
  'g'
)

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
      'src/renderer/src/routeTree.gen.ts',
      'packages/**/dist',
      'v2-refactor-temp/**'
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
        process.env.CI ? 'error' : 'warn',
        {
          selector: 'CallExpression[callee.object.name="console"]',
          message:
            '❗CherryStudio uses unified LoggerService: 📖 docs/en/guides/logging.md\n❗CherryStudio 使用统一的日志服务：📖 docs/zh/guides/logging.md\n\n'
        }
      ]
    }
  },
  // DataApi handler boundary — handlers must be SQL-only.
  // See packages/shared/data/api/schemas/files.ts and
  // docs/references/file/architecture.md §4.1.1 for the full rationale:
  // handlers MUST NOT touch FS, MUST NOT call main-side resolvers,
  // MUST NOT consult in-memory caches outside the DB. Anything requiring
  // FS IO or main-side compute lives on File IPC (FileManager), never here.
  {
    files: ['src/main/data/api/handlers/**/*.{ts,tsx,js,jsx}'],
    ignores: ['src/main/data/api/handlers/**/__tests__/**', 'src/main/data/api/handlers/**/*.test.*'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@main/file', '@main/file/*'],
              message:
                '❌ DataApi handlers must be SQL-only. For FS / cache / resolver access, expose the capability via File IPC (FileManager) instead — see docs/references/file/architecture.md §4.1.1.'
            },
            {
              group: ['fs', 'fs/*', 'node:fs', 'node:fs/*'],
              message:
                '❌ DataApi handlers must not touch the filesystem. Move FS-dependent logic to File IPC.'
            },
            {
              group: ['@main/data/utils/pathResolver'],
              message:
                '❌ DataApi handlers must not call main-side path resolvers. Expose paths via File IPC `getPhysicalPath` instead.'
            }
          ]
        }
      ]
    }
  },
  // Application lifecycle - all quit-related APIs and events are managed by Application.ts
  {
    files: ['src/main/**/*.{ts,tsx,js,jsx}'],
    ignores: [
      'src/main/core/application/Application.ts',
      'src/main/data/migration/**',
      'src/main/**/__tests__/**',
      'src/main/**/__mocks__/**',
      'src/main/**/*.test.*'
    ],
    plugins: {
      lifecycle: {
        rules: {
          'no-direct-quit': {
            meta: {
              type: 'problem',
              docs: {
                description:
                  'Disallow direct use of quit-related Electron/Node.js APIs. All quit handling is centralized in Application.ts.',
                recommended: true
              },
              messages: {
                restricted:
                  'Quit-related APIs and events are managed by the Application lifecycle. Do not use "{{name}}" directly. See docs/en/references/lifecycle/application-overview.md'
              }
            },
            create(context) {
              const RESTRICTED_APP_METHODS = new Set(['quit', 'exit', 'relaunch'])
              const RESTRICTED_APP_EVENTS = new Set(['before-quit', 'will-quit', 'window-all-closed'])
              const RESTRICTED_SIGNALS = new Set(['SIGINT', 'SIGTERM'])

              return {
                CallExpression(node) {
                  const { callee } = node
                  if (callee.type !== 'MemberExpression') return
                  if (callee.object.type !== 'Identifier') return

                  const obj = callee.object.name
                  const prop = callee.property.type === 'Identifier' ? callee.property.name : null
                  if (!prop) return

                  // app.quit() / app.exit() / app.relaunch()
                  if (obj === 'app' && RESTRICTED_APP_METHODS.has(prop)) {
                    context.report({ node, messageId: 'restricted', data: { name: `app.${prop}()` } })
                    return
                  }

                  // app.on/once('before-quit'|'will-quit'|'window-all-closed', ...)
                  if (obj === 'app' && (prop === 'on' || prop === 'once')) {
                    const firstArg = node.arguments[0]
                    if (firstArg?.type === 'Literal' && RESTRICTED_APP_EVENTS.has(firstArg.value)) {
                      context.report({
                        node,
                        messageId: 'restricted',
                        data: { name: `app.${prop}('${firstArg.value}')` }
                      })
                    }
                    return
                  }

                  // process.on/once('SIGINT'|'SIGTERM', ...)
                  if (obj === 'process' && (prop === 'on' || prop === 'once')) {
                    const firstArg = node.arguments[0]
                    if (firstArg?.type === 'Literal' && RESTRICTED_SIGNALS.has(firstArg.value)) {
                      context.report({
                        node,
                        messageId: 'restricted',
                        data: { name: `process.${prop}('${firstArg.value}')` }
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
      'lifecycle/no-direct-quit': 'warn'
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
  // renderer legacy css var migration warnings
  {
    files: ['src/renderer/src/**/*.{ts,tsx,js,jsx}'],
    ignores: [
      'src/renderer/src/**/*.test.*',
      'src/renderer/src/**/__tests__/**',
      'src/renderer/src/**/__mocks__/**'
    ],
    plugins: {
      'renderer-styles': {
        rules: {
          'no-legacy-css-vars': {
            meta: {
              type: 'suggestion',
              docs: {
                description:
                  'Warn when renderer code references legacy CSS compatibility variables instead of the shared theme contract.',
                recommended: true
              },
              messages: {
                legacyVar:
                  'Legacy renderer CSS variable "{{variable}}" is deprecated. Prefer @cherrystudio/ui theme contract variables or Tailwind semantic utilities instead.'
              }
            },
            create(context) {
              function reportIfLegacyCssVar(node, text) {
                const matches = text.matchAll(LEGACY_RENDERER_CSS_VAR_REGEX)
                for (const match of matches) {
                  const variable = match[1]
                  if (!variable) continue
                  context.report({
                    node,
                    messageId: 'legacyVar',
                    data: { variable }
                  })
                }
              }

              return {
                Literal(node) {
                  if (typeof node.value !== 'string') return
                  reportIfLegacyCssVar(node, node.value)
                },
                TemplateElement(node) {
                  reportIfLegacyCssVar(node, node.value.raw)
                },
                JSXText(node) {
                  reportIfLegacyCssVar(node, node.value)
                }
              }
            }
          }
        }
      }
    },
    rules: {
      'renderer-styles/no-legacy-css-vars': 'warn'
    }
  },
  // Schema key naming convention (cache & preferences)
  // Supports both fixed keys and template keys:
  // - Fixed: 'app.user.avatar', 'chat.multi_select_mode'
  // - Template: 'scroll.position.${topicId}', 'entity.cache.${type}_${id}'
  // Template keys must follow the same dot-separated pattern as fixed keys.
  // When ${xxx} placeholders are treated as literal strings, the key must match: xxx.yyy.zzz_www
  {
    files: [
      'packages/shared/data/cache/cacheSchemas.ts',
      'packages/shared/data/preference/preferenceSchemas.ts',
      'src/main/core/paths/pathRegistry.ts'
    ],
    plugins: {
      'data-schema-key': {
        rules: {
          'valid-key': {
            meta: {
              type: 'problem',
              docs: {
                description:
                  'Enforce schema key naming convention: namespace.sub.key_name (template placeholders treated as literal strings)',
                recommended: true
              },
              messages: {
                invalidKey:
                  'Schema key "{{key}}" must follow format: namespace.sub.key_name (e.g., app.user.avatar, scroll.position.${id}). Template ${xxx} is treated as a literal string segment.',
                invalidTemplateVar:
                  'Template variable in "{{key}}" must be a valid identifier (e.g., ${id}, ${topicId}).'
              }
            },
            create(context) {
              /**
               * Validates a schema key for correct naming convention.
               *
               * Both fixed keys and template keys must follow the same pattern:
               * - Lowercase segments separated by dots
               * - Each segment: starts with letter, contains letters/numbers/underscores
               * - At least two segments (must have at least one dot)
               *
               * Template keys: ${xxx} placeholders are treated as literal string segments.
               * Example valid: 'scroll.position.${id}', 'entity.cache.${type}_${id}'
               * Example invalid: 'cache:${type}' (colon not allowed), '${id}' (no dot)
               *
               * @param {string} key - The schema key to validate
               * @returns {{ valid: boolean, error?: 'invalidKey' | 'invalidTemplateVar' }}
               */
              function validateKey(key) {
                // Check if key contains template placeholders
                const hasTemplate = key.includes('${')

                if (hasTemplate) {
                  // Validate template variable names first
                  const templateVarPattern = /\$\{([^}]*)\}/g
                  let match
                  while ((match = templateVarPattern.exec(key)) !== null) {
                    const varName = match[1]
                    // Variable must be a valid identifier: start with letter, contain only alphanumeric and underscore
                    if (!varName || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(varName)) {
                      return { valid: false, error: 'invalidTemplateVar' }
                    }
                  }

                  // Replace template placeholders with a valid segment marker
                  // Use 'x' as placeholder since it's a valid segment character
                  const keyWithoutTemplates = key.replace(/\$\{[^}]+\}/g, 'x')

                  // Template key must follow the same pattern as fixed keys
                  // when ${xxx} is treated as a literal string
                  const fixedKeyPattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/
                  if (!fixedKeyPattern.test(keyWithoutTemplates)) {
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
