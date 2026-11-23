import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', policy: 'src/policy.ts', testing: 'tests/scriptedHost.ts' },
  format: ['esm'],
  platform: 'node',
  dts: true,
  clean: true
})
