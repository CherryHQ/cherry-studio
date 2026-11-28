import { createRequire } from 'node:module'
import { resolve } from 'node:path'

import { defineConfig } from 'electron-vite'

const require = createRequire(import.meta.url)
const requirePi = createRequire(require.resolve('@cherrystudio/agent-runtime-pi-acp/package.json'))

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      outDir: resolve('out/pi-acp'),
      lib: { entry: requirePi.resolve('pi-acp') },
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
            source: await readFile(requirePi.resolve('pi-acp/LICENSE'), 'utf8')
          })
        }
      }
    ]
  }
})
