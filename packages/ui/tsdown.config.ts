import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'components/index': 'src/components/index.ts',
    'icons/index': 'src/components/icons/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'utils/index': 'src/utils/index.ts',
    'composites/markdown/index': 'src/components/composites/markdown/index.ts',
    'composites/markdown/presets': 'src/components/composites/markdown/presets.ts',
    'composites/markdown/styles': 'src/components/composites/markdown/styles.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json',
  external: ['react', 'react-dom', 'framer-motion', 'tailwindcss', 'unist-util-visit']
})
