import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'code-highlight': 'src/code-highlight.ts',
    'code-block': 'src/code-block.ts',
    mermaid: 'src/mermaid.ts',
    'components/index': 'src/components/index.ts',
    'icons/index': 'src/components/icons/index.ts',
    'icons/providers/index': 'src/components/icons/providers/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'utils/index': 'src/utils/index.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json',
  deps: {
    neverBundle: ['react', 'react-dom', 'motion', 'tailwindcss', 'unist-util-visit']
  }
})
