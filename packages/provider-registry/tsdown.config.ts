import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'registry-loader': 'src/registry-loader.ts',
    'bundled-catalog': 'src/bundled-catalog.ts',
    'bundled-models': 'src/bundled-models.ts',
    'bundled-providers': 'src/bundled-providers.ts',
    'bundled-provider-models': 'src/bundled-provider-models.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json'
})
