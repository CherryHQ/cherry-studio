import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/stdio.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
