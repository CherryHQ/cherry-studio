const { defineConfig } = require('oxlint')

const ciSeverity = process.env.CI ? 'error' : 'warn'
const pageBoundarySeverity = process.env.RENDERER_PAGE_SIBLING_ERROR ? 'error' : 'warn'
const sourceTests = ['src/**/*.test.*', 'src/**/__tests__/**', 'src/**/__mocks__/**']
const rendererTests = ['src/renderer/**/*.test.*', 'src/renderer/**/__tests__/**', 'src/renderer/**/__mocks__/**']

module.exports = defineConfig({
  categories: {},
  env: { es2022: true },
  ignorePatterns: [
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
    'scripts/lint/__fixtures__/**',
    'src/main/services/nutstore/sso/lib/**',
    'src/renderer/ui/**',
    'src/renderer/routeTree.gen.ts',
    'packages/**/dist',
    'packages/**/storybook-static/**',
    'v2-refactor-temp/**'
  ],
  jsPlugins: [{ name: 'cherry', specifier: './scripts/lint/cherryPlugin.mjs' }],
  options: {
    respectEslintDisableDirectives: false,
    typeAware: true
  },
  plugins: ['unicorn', 'typescript', 'oxc', 'import', 'react'],
  rules: {
    'no-array-constructor': 'off',
    'no-caller': 'warn',
    'no-eval': 'warn',
    'no-fallthrough': 'warn',
    'no-unassigned-vars': 'warn',
    'no-unused-expressions': 'off',
    'no-unused-vars': [
      'warn',
      {
        caughtErrors: 'none',
        fix: { imports: 'fix', variables: 'suggestion' }
      }
    ],
    'no-useless-rename': 'warn',
    'oxc/bad-array-method-on-arguments': 'warn',
    'oxc/bad-char-at-comparison': 'warn',
    'oxc/bad-comparison-sequence': 'warn',
    'oxc/bad-min-max-func': 'warn',
    'oxc/bad-object-literal-comparison': 'warn',
    'oxc/bad-replace-all-arg': 'warn',
    'oxc/const-comparisons': 'warn',
    'oxc/double-comparisons': 'warn',
    'oxc/erasing-op': 'warn',
    'oxc/missing-throw': 'warn',
    'oxc/number-arg-out-of-range': 'warn',
    'oxc/only-used-in-recursion': 'off',
    'oxc/uninvoked-array-callback': 'warn',
    'react/exhaustive-deps': 'warn',
    'react/no-children-prop': 'off',
    'react/no-clone-element': 'warn',
    'react/no-react-children': 'warn',
    'react/rules-of-hooks': 'error',
    'typescript/await-thenable': 'warn',
    'typescript/consistent-type-imports': 'error',
    'typescript/no-array-constructor': 'error',
    'typescript/no-array-delete': 'warn',
    'typescript/no-base-to-string': 'off',
    'typescript/no-duplicate-enum-values': 'error',
    'typescript/no-duplicate-type-constituents': 'warn',
    'typescript/no-empty-object-type': 'off',
    'typescript/no-explicit-any': 'off',
    'typescript/no-extra-non-null-assertion': 'error',
    'typescript/no-floating-promises': 'warn',
    'typescript/no-for-in-array': 'warn',
    'typescript/no-implied-eval': 'off',
    'typescript/no-meaningless-void-operator': 'warn',
    'typescript/no-misused-new': 'error',
    'typescript/no-misused-spread': 'off',
    'typescript/no-namespace': 'error',
    'typescript/no-non-null-asserted-optional-chain': 'off',
    'typescript/no-redundant-type-constituents': 'off',
    'typescript/no-require-imports': 'off',
    'typescript/no-this-alias': 'error',
    'typescript/no-unnecessary-parameter-property-assignment': 'warn',
    // TODO: error — tsgolint 7 backlog (1508 diagnostics / 488 files), tracked in #17746
    'typescript/no-unnecessary-type-assertion': 'off',
    'typescript/no-unnecessary-type-constraint': 'error',
    'typescript/no-unsafe-declaration-merging': 'error',
    'typescript/no-unsafe-function-type': 'error',
    'typescript/no-unsafe-unary-minus': 'warn',
    'typescript/no-useless-default-assignment': 'off', // TODO: error — 1.76 default-warn; rule + fixes split to a dedicated PR
    'typescript/no-useless-empty-export': 'warn',
    'typescript/no-wrapper-object-types': 'error',
    'typescript/prefer-as-const': 'error',
    'typescript/prefer-namespace-keyword': 'error',
    'typescript/require-array-sort-compare': 'off',
    'typescript/restrict-template-expressions': 'off',
    'typescript/triple-slash-reference': 'error',
    'typescript/unbound-method': 'off',
    'unicorn/no-await-in-promise-methods': 'warn',
    'unicorn/no-empty-file': 'off',
    'unicorn/no-invalid-fetch-options': 'warn',
    'unicorn/no-invalid-remove-event-listener': 'warn',
    'unicorn/no-new-array': 'off',
    'unicorn/no-single-promise-in-promise-methods': 'warn',
    'unicorn/no-thenable': 'off',
    'unicorn/no-unnecessary-await': 'warn',
    'unicorn/no-useless-fallback-in-spread': 'warn',
    'unicorn/no-useless-length-check': 'warn',
    'unicorn/no-useless-spread': 'off',
    'unicorn/prefer-set-size': 'warn',
    'unicorn/prefer-string-starts-ends-with': 'warn',
    'cherry/no-prop-types': 'error',
    'cherry/no-template-in-t': 'warn',
    'cherry/prefer-zod-namespace': 'error'
  },
  overrides: [
    {
      files: [
        'src/main/**',
        'resources/scripts/**',
        'scripts/**',
        'playwright.config.ts',
        'electron.vite.config.ts',
        'packages/ui/scripts/**'
      ],
      env: { node: true }
    },
    {
      files: ['src/renderer/**/*.{ts,tsx}', 'packages/aiCore/**', 'packages/extension-table-plus/**', 'packages/ui/**'],
      env: { browser: true }
    },
    {
      files: ['**/__tests__/*.test.{ts,tsx}', 'tests/**'],
      env: { node: true, vitest: true }
    },
    {
      files: ['src/preload/**'],
      env: { browser: true, node: true }
    },
    {
      files: ['packages/ai-sdk-provider/**'],
      globals: { fetch: 'readonly' }
    },
    {
      files: ['src/**/*.{ts,tsx,js,jsx}'],
      excludeFiles: [...sourceTests, 'src/preload/**'],
      rules: { 'no-console': ciSeverity }
    },
    {
      files: ['src/**/*.{ts,tsx}'],
      excludeFiles: ['src/main/services/file/tree/**', ...sourceTests],
      rules: { 'cherry/no-as-filepath': ciSeverity }
    },
    {
      files: ['src/main/**/*.{ts,tsx,js,jsx}'],
      excludeFiles: [
        'src/main/core/application/Application.ts',
        'src/main/data/migration/**',
        'src/main/**/*.test.*',
        'src/main/**/__tests__/**',
        'src/main/**/__mocks__/**'
      ],
      rules: { 'cherry/no-direct-quit': 'warn' }
    },
    {
      files: ['src/renderer/**/*.{ts,tsx,js,jsx}'],
      excludeFiles: rendererTests,
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@shared/ipc/schemas', '@shared/ipc/schemas/*'],
                allowTypeImports: true,
                message:
                  'Renderer may only `import type` from @shared/ipc/schemas — a value import pulls the entire zod schema set into the renderer bundle.'
              }
            ]
          }
        ],
        'cherry/renderer-boundaries': 'error',
        'cherry/page-boundaries': pageBoundarySeverity
      }
    },
    {
      files: ['src/main/**/*.{ts,tsx,js,jsx}', 'src/preload/**/*.{ts,tsx,js,jsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              {
                group: ['@renderer', '@renderer/**', '**/renderer/**'],
                message:
                  'Main/preload must not import renderer code. Use `@shared` for cross-process types, or `src/main` for main-only types. See docs/references/shared-layer-architecture.md.'
              },
              {
                group: ['drizzle-orm/*/migrator'],
                message:
                  "Do not call drizzle's migrate() directly — its transaction makes drizzle-kit's `PRAGMA foreign_keys=OFF` a no-op. Use applyMigrations() from @data/db/applyMigrations."
              }
            ]
          }
        ]
      }
    },
    {
      files: ['src/**/*.{ts,tsx}'],
      excludeFiles: sourceTests,
      rules: {
        'cherry/no-export-star': 'error',
        'cherry/index-no-impl': 'error',
        'cherry/no-index-tsx': 'error',
        'cherry/barrel-named-only': 'error',
        'cherry/barrel-closed': 'error',
        'cherry/barrel-no-nesting': 'error',
        'cherry/no-bucket-root-barrel': 'error'
      }
    },
    {
      files: ['src/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
      rules: { 'cherry/path-case': 'error' }
    },
    {
      // Oxlint's native React rules intentionally follow static React imports. These mocks load
      // React through vi.importActual(), so the local rules preserve the existing diagnostics.
      files: [
        'src/renderer/pages/code/components/configEditPanel/tools/__tests__/ClaudeConfigFields.test.tsx',
        'src/renderer/pages/code/components/configEditPanel/tools/__tests__/CliConfigFields.test.tsx'
      ],
      rules: {
        'cherry/dynamic-react-children-map': 'warn',
        'cherry/dynamic-react-clone-element': 'warn'
      }
    },
    {
      files: [
        'src/shared/data/cache/cacheSchemas.ts',
        'src/shared/data/preference/preferenceSchemas.ts',
        'src/main/core/paths/pathRegistry.ts',
        'src/shared/ipc/schemas/**/*.ts'
      ],
      rules: { 'cherry/valid-schema-key': 'error' }
    }
  ]
})
