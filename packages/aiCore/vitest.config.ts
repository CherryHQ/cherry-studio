import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true
  },
  resolve: {
    alias: {
      '@': './src'
    }
  },
  esbuild: {
    target: 'node18'
  }
})
