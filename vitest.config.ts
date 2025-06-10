import { defineConfig } from 'vitest/config'

import electronViteConfig from './electron.vite.config'

const mainConfig = (electronViteConfig as any).main
const rendererConfig = (electronViteConfig as any).renderer

export default defineConfig({
  test: {
    workspace: [
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
          include: ['src/main/**/*.{test,spec}.{ts,tsx}', 'src/main/**/__tests__/**/*.{test,spec}.{ts,tsx}']
        }
      },
      // 渲染进程单元测试配置
      {
        extends: true,
        // exclude tailwindcss plugin
        plugins: rendererConfig.plugins.slice(1),
        resolve: {
          alias: rendererConfig.resolve.alias
        },
        test: {
          name: 'renderer',
          environment: 'jsdom',
          setupFiles: ['@vitest/web-worker', 'tests/renderer.setup.ts'],
          include: ['src/renderer/**/*.{test,spec}.{ts,tsx}', 'src/renderer/**/__tests__/**/*.{test,spec}.{ts,tsx}']
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
