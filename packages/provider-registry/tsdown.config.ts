import { defineConfig } from 'tsdown'

// Two entries: the default runtime surface (`index`) and the Node-only loader (`./node` →
// `registry-loader`). A package-local tsconfig (no project `references`) is required so
// rolldown-plugin-dts can emit declarations — the root tsconfig's `references` break it.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'registry-loader': 'src/registry-loader.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json'
})
