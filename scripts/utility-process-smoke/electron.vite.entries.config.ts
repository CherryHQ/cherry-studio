import path from 'node:path'

import { isMainExternalModule } from '../../electron.vite.config'
import { hermeticEntryGuardPlugin } from '../utilityProcessEntryGuard'
import { smokeAppDir } from './appDir'

export default {
  main: {
    plugins: [hermeticEntryGuardPlugin()],
    build: {
      emptyOutDir: true,
      outDir: path.join(smokeAppDir(), 'out', 'utility-process'),
      lib: {
        entry: {
          // Keys become `<entry>.js`, which is what a definition's `entry` resolves to.
          'smoke-echo': path.resolve(__dirname, 'harness/utilityEntries/smokeEcho.ts'),
          'smoke-echo-terminate': path.resolve(__dirname, 'harness/utilityEntries/smokeEchoTerminate.ts')
        }
      },
      rollupOptions: {
        external: isMainExternalModule,
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          format: 'cjs',
          hoistTransitiveImports: false
        }
      },
      sourcemap: true
    }
  }
}
