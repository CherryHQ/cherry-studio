import { createRequire } from 'node:module'

import { build, type Plugin } from 'vite'

export function piVccBundlePlugin(): Plugin {
  return {
    name: 'cherry-pi-vcc-bundle',
    apply: 'build',
    async buildStart() {
      // Pi's import-only SDK cannot be required by the main CJS bundle.
      await build({
        configFile: false,
        publicDir: false,
        logLevel: 'warn',
        ssr: { noExternal: true },
        build: {
          ssr: true,
          write: false,
          minify: false,
          lib: {
            entry: createRequire(import.meta.url).resolve('@sting8k/pi-vcc'),
            formats: ['es']
          },
          rolldownOptions: {
            external: ['@earendil-works/pi-coding-agent'],
            output: { entryFileNames: 'pi-vcc.mjs' }
          }
        },
        plugins: [
          {
            name: 'emit-pi-vcc-bundle',
            generateBundle: (_options, bundle) => {
              for (const output of Object.values(bundle)) {
                if (output.type === 'chunk') {
                  for (const id of output.moduleIds) this.addWatchFile(id)
                }
                this.emitFile({
                  type: 'asset',
                  fileName: output.fileName,
                  source: output.type === 'chunk' ? output.code : output.source
                })
              }
            }
          }
        ]
      })
    }
  }
}
