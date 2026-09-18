import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/contracts.ts', 'src/nativeClient.ts'],
  clean: false,
  dts: true,
  deps: {
    neverBundle: ['node:child_process', 'node:fs/promises']
  },
  format: ['esm', 'cjs'],
  platform: 'node',
  sourcemap: true
})
