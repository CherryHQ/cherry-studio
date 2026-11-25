import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/adapter.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
