import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/adapter.ts', 'src/legacyAcp.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
