import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  fixedExtension: true,
  platform: 'neutral',
  target: 'es2020',
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json'
})
