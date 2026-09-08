import path from 'node:path'

import { isMainExternalModule } from '../../electron.vite.config'
import { smokeAppDir } from './appDir'

export default {
  main: {
    build: {
      emptyOutDir: true,
      outDir: path.join(smokeAppDir(), 'out', 'main'),
      lib: { entry: { index: path.resolve(__dirname, 'harness/main.ts') } },
      rollupOptions: {
        external: isMainExternalModule,
        output: { entryFileNames: '[name].js', format: 'cjs' }
      },
      sourcemap: true
    }
  }
}
