import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/contracts.ts', 'src/nativeClient.ts', 'src/webmToWav.ts'],
  clean: true,
  dts: true,
  deps: {
    neverBundle: ['node:child_process', 'node:fs/promises']
  },
  format: ['esm'],
  platform: 'neutral',
  sourcemap: true
})
