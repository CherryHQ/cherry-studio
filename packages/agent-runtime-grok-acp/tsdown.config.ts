import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/adapter.ts', 'src/cli.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
