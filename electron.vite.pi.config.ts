import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { defineConfig } from 'electron-vite'

const require = createRequire(import.meta.url)

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      outDir: resolve('out/pi-acp'),
      lib: { entry: require.resolve('pi-acp') },
      rolldownOptions: { output: { format: 'es', entryFileNames: 'index.mjs' } }
    },
    plugins: [
      {
        name: 'pi-acp-license',
        async generateBundle() {
          const { readFile } = await import('node:fs/promises')
          this.emitFile({
            type: 'asset',
            fileName: 'LICENSE',
            source: await readFile(require.resolve('pi-acp/LICENSE'), 'utf8')
          })
        }
      }
    ]
  }
})
