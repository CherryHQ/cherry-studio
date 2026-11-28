import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss()],
  esbuild: { jsx: 'automatic' },
  optimizeDeps: { entries: ['tests/browser/icon-focus/index.html'] },
  resolve: {
    alias: [
      // The grid uses Input only. Load that real primitive without unrelated UI entrypoints.
      { find: /^@cherrystudio\/ui$/, replacement: resolve('packages/ui/src/components/primitives/input.tsx') },
      { find: '@cherrystudio/ui/styles', replacement: resolve('packages/ui/src/styles') },
      { find: '@cherrystudio/ui/lib', replacement: resolve('packages/ui/src/lib') }
    ]
  },
  server: { host: '127.0.0.1', port: 4178, strictPort: true }
})
