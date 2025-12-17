import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  test: {
    globals: true,
    setupFiles: [path.resolve(__dirname, './src/__tests__/setup.ts')]
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // Mock external packages that may not be available in test environment
      '@cherrystudio/ai-sdk-provider': path.resolve(__dirname, './src/__tests__/mocks/ai-sdk-provider.ts')
    }
  },
  esbuild: {
    target: 'node18'
  }
})
