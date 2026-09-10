import { resolve } from 'path'

import { isMainExternalModule, mainResolveAlias } from './electron.vite.config'
import { hermeticEntryGuardPlugin } from './scripts/utilityProcessEntryGuard'

/**
 * Second build pass for Electron utility-process entries. They are separate bundles, not
 * chunks of the main bundle: each is `require`d by a fresh Node runtime that has no
 * lifecycle container, no logger and no database, and `app.utility_process` resolves a
 * definition's `entry` key to `<appPath>/out/utility-process/<entry>.js`.
 *
 * Run by `pnpm build` and `pnpm dev`; entries do NOT hot-reload — re-run
 * `pnpm build:utility-process` after changing one.
 *
 * See docs/references/utility-process/README.md.
 */
export default {
  main: {
    plugins: [hermeticEntryGuardPlugin()],
    resolve: { alias: mainResolveAlias },
    build: {
      emptyOutDir: true,
      outDir: resolve(__dirname, 'out/utility-process'),
      lib: {
        // Keys become `<entry>.js`, which is what a definition's `entry` resolves to.
        entry: {
          'inference-embedding': resolve(
            __dirname,
            'src/main/ai/localModel/runtime/utilityEntries/inferenceEmbedding.ts'
          ),
          'inference-ocr': resolve(__dirname, 'src/main/ai/localModel/runtime/utilityEntries/inferenceOcr.ts')
        }
      },
      rollupOptions: {
        external: isMainExternalModule,
        output: {
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          format: 'cjs',
          hoistTransitiveImports: false
          // No `preserveModules`: it mirrors the source tree, which puts bundled
          // devDependencies under `out/utility-process/node_modules/**` — a path
          // electron-builder strips, so the child died with MODULE_NOT_FOUND in the
          // packaged app. Flat chunks keep every emitted file inside the output dir;
          // `utilityProcessEntryGuard` fails the build if that ever stops holding.
        }
      },
      sourcemap: true
    }
  }
}
