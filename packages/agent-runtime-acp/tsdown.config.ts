import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/v1.ts', 'src/profile.ts'],
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
