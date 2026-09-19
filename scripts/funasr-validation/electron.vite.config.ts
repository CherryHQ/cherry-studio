import path from 'node:path'

import { mainExternalModules, mainResolveAlias } from '../../electron.vite.config'

const outputDir = process.env.FUNASR_VALIDATION_APP_DIR
if (!outputDir || !path.isAbsolute(outputDir)) {
  throw new Error('FUNASR_VALIDATION_APP_DIR must be an absolute path')
}

export default {
  main: {
    resolve: { alias: mainResolveAlias },
    build: {
      externalizeDeps: { include: mainExternalModules },
      emptyOutDir: true,
      outDir: path.join(outputDir, 'out', 'main'),
      lib: { entry: { index: path.resolve(__dirname, 'main.ts') } },
      rolldownOptions: { output: { entryFileNames: '[name].js', format: 'cjs' } },
      sourcemap: true
    }
  }
}
