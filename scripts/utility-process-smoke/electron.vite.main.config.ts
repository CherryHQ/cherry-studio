import path from 'node:path'

import { mainExternalModules } from '../../electron.vite.config'
import { smokeAppDir } from './appDir'

export default {
  main: {
    build: {
      externalizeDeps: { include: mainExternalModules },
      emptyOutDir: true,
      outDir: path.join(smokeAppDir(), 'out', 'main'),
      lib: { entry: { index: path.resolve(__dirname, 'harness/main.ts') } },
      rolldownOptions: {
        output: { entryFileNames: '[name].js', format: 'cjs' }
      },
      sourcemap: true
    }
  }
}
