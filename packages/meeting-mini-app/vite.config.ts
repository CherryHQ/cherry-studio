import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig } from 'vite'

export default defineConfig(() => {
  return {
    base: './',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: [
        { find: /^@cherrystudio\/ui$/, replacement: fileURLToPath(new URL('../ui/src/index.ts', import.meta.url)) },
        { find: '@cherrystudio/ui', replacement: fileURLToPath(new URL('../ui/src', import.meta.url)) }
      ],
      dedupe: ['react', 'react-dom']
    },
    build: { target: 'es2022', rollupOptions: { output: { inlineDynamicImports: true } } }
  }
})
