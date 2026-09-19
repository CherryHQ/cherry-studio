import { resolve } from 'node:path'

import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  root: import.meta.dirname,
  build: {
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, 'dist')
  }
})
