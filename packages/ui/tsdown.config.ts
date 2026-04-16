import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    'components/index': 'src/components/index.ts',
    'hooks/index': 'src/hooks/index.ts',
    'utils/index': 'src/utils/index.ts'
  },
  outDir: 'dist',
  format: ['esm', 'cjs'],
  clean: true,
  dts: true,
  tsconfig: 'tsconfig.json',
  external: [
    'react',
    'react-dom',
    'framer-motion',
    'tailwindcss',
    // 保留 styled-components 作为外部依赖（迁移期间）
    'styled-components'
  ]
})
