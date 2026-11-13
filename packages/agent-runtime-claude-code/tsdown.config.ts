import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/archiveWorker.mjs'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
