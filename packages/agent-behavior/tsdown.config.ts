import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/policy.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
