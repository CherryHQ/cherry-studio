import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'sandbox-acceptance',
    environment: 'node',
    include: ['tests/acceptance/**/*.test.ts'],
    testTimeout: 30000
  }
})
