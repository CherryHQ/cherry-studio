import path from 'node:path'

import { isMainExternalModule } from '../../electron.vite.config'
import { hermeticEntryGuardPlugin } from '../utilityProcessEntryGuard'
import { smokeAppDir } from './appDir'

const repoRoot = path.resolve(__dirname, '../..')

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
          format: 'cjs',
          hoistTransitiveImports: false,
          // Keeps emitted paths stable and readable. Not required for correctness here —
          // entries are built without a main entry in the graph, so the RFC E1 folding mode
          // (one entry requiring the other) cannot arise; a consumer that adds entries to the
          // main build does need it.
          preserveModules: true,
          preserveModulesRoot: repoRoot
        }
      },
      sourcemap: true
    }
  }
}
