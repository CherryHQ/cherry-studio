import { defineConfig } from 'vitest/config'

// Package-local config: without it `vitest run` here resolves the repo-root
// projects config, whose relative paths break outside the root.
export default defineConfig({
  test: {
    environment: 'node'
  }
})
