import { defineConfig } from 'tsdown'

export default defineConfig(
  [
    'src/table/index.ts',
    'src/cell/index.ts',
    'src/header/index.ts',
    'src/kit/index.ts',
    'src/row/index.ts',
    'src/index.ts'
  ].map((entry) => ({
    entry: [entry],
    tsconfig: '../../tsconfig.build.json',
    outDir: `dist${entry.replace('src', '').split('/').slice(0, -1).join('/')}`,
    dts: true,
    sourcemap: true,
    format: ['esm', 'cjs'],
    external: [/^[^./]/]
  }))
)
