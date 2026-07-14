import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

import electronViteConfig from './electron.vite.config'

// Pin the test timezone to UTC so date-dependent tests are deterministic on every
// machine. CI runners default to UTC; without this, tests that bucket UTC timestamps
// by local day (e.g. Topics "Today/Yesterday") pass in CI but fail on dev machines in
// a non-UTC zone. Set here (main process, before workers spawn) so every thread worker
// inherits TZ=UTC at creation and V8 parses Date in UTC from the start.
process.env.TZ = 'UTC'

// Fork workers pipe their output into the runner streams. The full suite can
// legitimately attach more listeners than Node's default warning threshold.
process.stdout.setMaxListeners(64)
process.stderr.setMaxListeners(64)

const mainConfig = (electronViteConfig as any).main
const rendererConfig = (electronViteConfig as any).renderer

export default defineConfig({
  test: {
    projects: [
      // 主进程单元测试配置
      {
        extends: true,
        plugins: mainConfig.plugins,
        resolve: {
          alias: mainConfig.resolve.alias
        },
        test: {
          name: 'main',
          environment: 'node',
          // This project loads the REAL native better-sqlite3, which is ABI-specific (it is NOT
          // an N-API module). Vitest runs under system Node, so the module must be built for the
          // Node ABI — `pretest:main` guarantees that via `pnpm rebuild:node`. `pnpm dev` and
          // packaging flip it to the Electron ABI instead (`pnpm rebuild:electron`); each flip is
          // a cached restore (~0.3s/~2s), not a recompile. See
          // docs/references/testing/database-testing.md.
          //
          // pool: 'forks' — better-sqlite3 is a NAN/V8 native addon that is not safe under
          // worker_threads (its finalizers crash at thread teardown — SIGSEGV at process exit).
          // Forks give each worker a clean V8 isolate. (This mirrors Vitest 3's own default pool,
          // which is `forks` for native-addon safety; the global config below overrides it back
          // to the faster `threads` for the non-native projects.)
          pool: 'forks',
          setupFiles: ['tests/main.setup.ts'],
          include: [
            'src/main/**/*.{test,spec}.{ts,tsx}',
            'src/main/**/__tests__/**/*.{test,spec}.{ts,tsx}',
            'tests/helpers/**/__tests__/**/*.{test,spec}.{ts,tsx}'
          ],
          exclude: ['src/main/utils/**'],
          benchmark: {
            include: ['src/main/**/*.bench.{ts,tsx}', 'src/main/**/__tests__/**/*.bench.{ts,tsx}']
          }
        }
      },
      // Main-process utilities avoid native addons that are unsafe under worker_threads,
      // such as better-sqlite3, so they can use the faster thread pool.
      {
        extends: true,
        plugins: mainConfig.plugins,
        resolve: {
          alias: mainConfig.resolve.alias
        },
        test: {
          name: 'main-utils',
          environment: 'node',
          setupFiles: ['tests/main.setup.ts'],
          include: ['src/main/utils/**/*.{test,spec}.{ts,tsx}']
        }
      },
      // 渲染进程单元测试配置
      {
        extends: true,
        plugins: rendererConfig.plugins.filter((plugin: any) => plugin.name !== 'tailwindcss'),
        resolve: {
          alias: rendererConfig.resolve.alias
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['@vitest/web-worker', 'tests/renderer.setup.ts'],
          include: ['src/renderer/**/*.{test,spec}.{ts,tsx}', 'src/renderer/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
          exclude: [
            'src/renderer/utils/**',
            'src/renderer/components/icons/__tests__/iconCatalog.lazy.test.ts',
            'src/renderer/windows/quickAssistant/home/__tests__/HomeWindow.lazy.test.ts',
            'src/renderer/windows/selection/action/components/__tests__/actionResultContent.lazy.test.ts'
          ],
          benchmark: {
            include: ['src/renderer/**/*.bench.{ts,tsx}', 'src/renderer/**/__tests__/**/*.bench.{ts,tsx}']
          }
        }
      },
      // 纯工具测试默认不需要浏览器环境；确实依赖 DOM 的文件可用
      // `@vitest-environment jsdom` 在文件级别显式启用。
      {
        extends: true,
        plugins: rendererConfig.plugins.filter((plugin: any) => plugin.name !== 'tailwindcss'),
        resolve: {
          alias: rendererConfig.resolve.alias
        },
        test: {
          name: 'renderer-utils',
          environment: 'node',
          setupFiles: ['tests/renderer.setup.ts'],
          include: ['src/renderer/utils/**/*.{test,spec}.ts']
        }
      },
      // Lazy-boundary tests only inspect module evaluation. Keeping them out of
      // the jsdom-heavy renderer pool avoids large transform graphs competing
      // with UI tests under full-suite concurrency.
      {
        extends: true,
        plugins: rendererConfig.plugins.filter((plugin: any) => plugin.name !== 'tailwindcss'),
        resolve: {
          alias: rendererConfig.resolve.alias
        },
        test: {
          name: 'renderer-architecture',
          environment: 'jsdom',
          fileParallelism: false,
          setupFiles: ['tests/renderer.setup.ts'],
          include: [
            'src/renderer/components/icons/__tests__/iconCatalog.lazy.test.ts',
            'src/renderer/windows/quickAssistant/home/__tests__/HomeWindow.lazy.test.ts',
            'src/renderer/windows/selection/action/components/__tests__/actionResultContent.lazy.test.ts'
          ]
        }
      },
      // 脚本单元测试配置
      {
        extends: true,
        test: {
          name: 'scripts',
          environment: 'node',
          include: ['scripts/**/*.{test,spec}.{ts,tsx}', 'scripts/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
          benchmark: {
            include: ['scripts/**/*.bench.{ts,tsx}', 'scripts/**/__tests__/**/*.bench.{ts,tsx}']
          }
        }
      },
      // aiCore 包单元测试配置
      {
        extends: 'packages/aiCore/vitest.config.ts',
        test: {
          name: 'aiCore',
          environment: 'node',
          include: [
            'packages/aiCore/**/*.{test,spec}.{ts,tsx}',
            'packages/aiCore/**/__tests__/**/*.{test,spec}.{ts,tsx}'
          ],
          benchmark: {
            include: ['packages/aiCore/**/*.bench.{ts,tsx}', 'packages/aiCore/**/__tests__/**/*.bench.{ts,tsx}']
          }
        }
      },
      // shared 包单元测试配置
      {
        extends: true,
        resolve: {
          alias: {
            '@shared': resolve('src/shared'),
            '@cherrystudio/provider-registry/node': resolve('packages/provider-registry/src/registry-loader'),
            '@cherrystudio/provider-registry': resolve('packages/provider-registry/src')
          }
        },
        test: {
          name: 'shared',
          environment: 'node',
          include: ['src/shared/**/*.{test,spec}.{ts,tsx}', 'src/shared/**/__tests__/**/*.{test,spec}.{ts,tsx}'],
          benchmark: {
            include: ['src/shared/**/*.bench.{ts,tsx}', 'src/shared/**/__tests__/**/*.bench.{ts,tsx}']
          }
        }
      },
      // provider-registry 包单元测试配置
      {
        extends: true,
        resolve: {
          alias: {
            '@shared': resolve('src/shared'),
            '@cherrystudio/provider-registry/node': resolve('packages/provider-registry/src/registry-loader'),
            '@cherrystudio/provider-registry': resolve('packages/provider-registry/src')
          }
        },
        test: {
          name: 'provider-registry',
          environment: 'node',
          include: [
            'packages/provider-registry/**/*.{test,spec}.{ts,tsx}',
            'packages/provider-registry/**/__tests__/**/*.{test,spec}.{ts,tsx}'
          ]
        }
      },
      // packages/ui 单元测试配置
      {
        extends: true,
        resolve: {
          alias: {
            '@cherrystudio/ui': resolve(__dirname, 'packages/ui/src')
          }
        },
        test: {
          name: 'ui',
          environment: 'node',
          include: [
            'packages/ui/scripts/**/*.{test,spec}.{ts,tsx}',
            'packages/ui/src/**/*.{test,spec}.{ts,tsx}',
            'packages/ui/src/**/__tests__/**/*.{test,spec}.{ts,tsx}'
          ]
        }
      }
    ],
    // 全局共享配置
    globals: true,
    setupFiles: [],
    exclude: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/build/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'text-summary'],
      exclude: [
        '**/node_modules/**',
        '**/dist/**',
        '**/out/**',
        '**/build/**',
        '**/coverage/**',
        '**/tests/**',
        '**/.yarn/**',
        '**/.cursor/**',
        '**/.vscode/**',
        '**/.github/**',
        '**/.husky/**',
        '**/*.d.ts',
        '**/types/**',
        '**/__tests__/**',
        '**/*.{test,spec}.{ts,tsx}',
        '**/*.config.{js,ts}'
      ]
    },
    testTimeout: 20000,
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false
      }
    }
  }
})
