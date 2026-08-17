import { defineConfig } from 'tsdown'

// A package-local tsconfig (no project `references`) is required so
// rolldown-plugin-dts can emit declarations — the root tsconfig's `references` break it.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    clean: true,
    dts: true,
    tsconfig: 'tsconfig.json'
  },
  {
    // Runs inside the dsh Node subprocess: ESM only; dsh packages resolve there at runtime.
    entry: { plugin: 'src/plugin.ts' },
    outDir: 'dist',
    format: ['esm'],
    clean: false,
    dts: false,
    external: [/^@deepseek-ai\//],
    tsconfig: 'tsconfig.json'
  }
])
