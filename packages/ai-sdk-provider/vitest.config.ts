import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@ai-sdk/openai-compatible': resolve(__dirname, '../../node_modules/@ai-sdk/openai-compatible/dist/index.js')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}', 'src/**/__tests__/**/*.{test,spec}.{ts,tsx}']
  }
})
