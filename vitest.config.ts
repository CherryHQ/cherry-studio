import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

import electronViteConfig from './electron.vite.config'

// Pin the test timezone to UTC so date-dependent tests are deterministic on every
// machine. CI runners default to UTC; without this, tests that bucket UTC timestamps
// by local day (e.g. Topics "Today/Yesterday") pass in CI but fail on dev machines in
// a non-UTC zone. Set here (main process, before workers spawn) so every thread worker
// inherits TZ=UTC at creation and V8 parses Date in UTC from the start.
process.env.TZ = 'UTC'

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
          setupFiles: ['tests/main.setup.ts'],
          include: [
            'src/main/**/*.{test,spec}.{ts,tsx}',
            'src/main/**/__tests__/**/*.{test,spec}.{ts,tsx}',
            'tests/helpers/**/__tests__/**/*.{test,spec}.{ts,tsx}'
          ],
          benchmark: {
            include: ['src/main/**/*.bench.{ts,tsx}', 'src/main/**/__tests__/**/*.bench.{ts,tsx}']
          }
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
          benchmark: {
            include: ['src/renderer/**/*.bench.{ts,tsx}', 'src/renderer/**/__tests__/**/*.bench.{ts,tsx}']
          }
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
