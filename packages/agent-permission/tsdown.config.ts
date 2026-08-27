import { defineConfig } from 'tsdown'

// Keep the browser-safe root separate from the Node-only evaluator/path helpers.
export default defineConfig({
  entry: {
    index: 'src/index.ts',
    node: 'src/node.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json'
})
