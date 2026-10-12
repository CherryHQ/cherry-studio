import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'sandbox',
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: [...configDefaults.exclude, 'tests/acceptance/**'],
    testTimeout: 15000
  }
})
