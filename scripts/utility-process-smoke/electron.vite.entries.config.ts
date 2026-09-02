import path from 'node:path'

import { isMainExternalModule } from '../../electron.vite.config'
import { smokeAppDir } from './appDir'
import { hermeticEntryGuardPlugin } from './hermeticEntryGuardPlugin'

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
          // Without preserved modules Rolldown folds one entry into the other and both
          // processes execute both entries.
          preserveModules: true,
          preserveModulesRoot: repoRoot
        }
      },
      sourcemap: true
    }
  }
}
