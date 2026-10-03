import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'components/index': 'src/components/index.ts',
    'components/composites/justified-paragraph': 'src/components/composites/justified-paragraph.tsx',
    'icons/index': 'src/components/icons/index.ts',
    'icons/providers/index': 'src/components/icons/providers/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'utils/index': 'src/utils/index.ts',
    'utils/paragraph-layout': 'src/utils/paragraph-layout.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json',
  deps: {
    alwaysBundle: [/^justif(?:\/|$)/],
    neverBundle: ['react', 'react-dom', 'motion', 'tailwindcss', 'unist-util-visit']
  }
})
