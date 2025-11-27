import path from 'node:path'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts']
  },
  resolve: {
    alias: {
      '@': './src',
      // Mock external packages that may not be available in test environment
      '@cherrystudio/ai-sdk-provider': path.resolve(__dirname, './src/__tests__/mocks/ai-sdk-provider.ts')
    }
  },
  esbuild: {
    target: 'node18'
  }
})
