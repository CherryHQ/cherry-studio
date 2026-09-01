import { readdirSync, readFileSync } from 'fs'
import { join, resolve } from 'path'

import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { visualizer } from 'rollup-plugin-visualizer'
import type { Plugin } from 'vite'
import { parse } from 'yaml'

// Import attributes are not supported by the current Electron config loader.
// import pkg from './package.json' assert { type: 'json' }
import pkg from './package.json'
import { buildFlatContractCss } from './packages/ui/scripts/build-theme-css'
import { chunkExportGuardPlugin } from './scripts/checkChunkExports'
import { uiContractPlugin } from './scripts/uiContract/vitePlugin'
import { parseReleaseHistory, validateCurrentReleaseHistory } from './src/shared/utils/releaseNotes'

type ElectronBuilderConfig = {
  releaseInfo?: {
    releaseNotes?: unknown
  }
}

const electronBuilderConfig = parse(
  readFileSync(resolve(__dirname, 'electron-builder.yml'), 'utf8')
) as ElectronBuilderConfig
const bundledReleaseNotes = electronBuilderConfig.releaseInfo?.releaseNotes
const bundledReleaseHistory = parseReleaseHistory(
  readFileSync(resolve(__dirname, 'resources/cherry-studio/release-history.json'), 'utf8')
)

if (typeof bundledReleaseNotes !== 'string' || !bundledReleaseNotes.trim()) {
  throw new Error('electron-builder.yml must define non-empty releaseInfo.releaseNotes')
}
validateCurrentReleaseHistory({ releaseNotes: bundledReleaseNotes, version: pkg.version }, bundledReleaseHistory)

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

// Bundle/externalize split for the main process: everything in `dependencies` is
// marked `external` below (kept in node_modules of the packaged app), and everything
// NOT in `dependencies` (i.e. in `devDependencies`) is bundled into the main bundle by
// rollup. The API gateway's Elysia stack (`elysia`, `@elysia/*`) is intentionally in
// `devDependencies` for exactly this reason — it is pure JS and bundles cleanly. Do NOT
// move it to `dependencies`: that would externalize it, and since devDependencies are
// pruned from production packages, the packaged app would fail at runtime with
// MODULE_NOT_FOUND (no test catches this). See docs/references/api-gateway/README.md.
const mainExternalDependencies = [
  ...Object.keys(pkg.dependencies),
  // optionalDependencies too: platform-gated natives (e.g. node-mac-permissions) are real import
  // targets, not napi sub-packages, so rollup would fail on the .node; production keeps them installed.
  ...Object.keys(pkg.optionalDependencies ?? {})
]
const mainExternalModules = ['bufferutil', 'utf-8-validate', 'electron', ...mainExternalDependencies]

export const isMainExternalModule = (id: string) => {
  return mainExternalModules.some((moduleId) => id === moduleId || id.startsWith(`${moduleId}/`))
}

// Ships the flat theme contract next to the main bundle so mini apps can be served
// `assets/miniAppTheme.css`. Built in-process: nothing in the app pipeline runs the ui package build.
const miniAppThemeAssetPlugin = (): Plugin => ({
  name: 'cherry-mini-app-theme-asset',
  // The sources live outside the main bundle's module graph, so `electron-vite dev` would
  // serve a stale `miniAppTheme.css` after a token edit. Registered in `buildStart` because
  // `addWatchFile` is a build-phase call — it is not available from `generateBundle`.
  buildStart() {
    const stylesDir = resolve('packages/ui/src/styles')
    for (const name of readdirSync(stylesDir, { recursive: true, encoding: 'utf8' })) {
      if (name.endsWith('.css')) this.addWatchFile(join(stylesDir, name))
    }
  },
  async generateBundle() {
    let source: string
    try {
      source = await buildFlatContractCss()
    } catch (error) {
      return this.error(`failed to build assets/miniAppTheme.css: ${error instanceof Error ? error.message : error}`)
    }
    this.emitFile({ type: 'asset', fileName: 'assets/miniAppTheme.css', source })
  }
})

export default defineConfig({
  main: {
    plugins: [chunkExportGuardPlugin(), miniAppThemeAssetPlugin(), ...visualizerPlugin('main')],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@application': resolve('src/main/core/application/Application'),
        '@data': resolve('src/main/data'),
        '@shared': resolve('src/shared'),
        '@logger': resolve('src/main/core/logger/LoggerService'),
        '@cherrystudio/ai-core/provider': resolve('packages/aiCore/src/core/providers'),
        '@cherrystudio/ai-core/built-in/plugins': resolve('packages/aiCore/src/core/plugins/built-in'),
        '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
        '@cherrystudio/ai-sdk-provider': resolve('packages/ai-sdk-provider/src'),
        '@cherrystudio/provider-registry/node': resolve('packages/provider-registry/src/registry-loader'),
        '@cherrystudio/provider-registry': resolve('packages/provider-registry/src'),
        '@test-mocks': resolve('tests/__mocks__'),
        '@test-helpers': resolve('tests/helpers')
      }
    },
    build: {
      lib: { entry: resolve(__dirname, 'src/main/main.ts') },
      rollupOptions: {
        external: isMainExternalModule,
        output: {
          manualChunks: (id) => {
            // conf removes its containing file from require.cache; isolate it so the app entry stays cached.
            if (id.includes('/node_modules/conf/')) return 'electron-store-conf'
            // rolldown drops this chunk's named exports when it merges with a re-export-only
            // facade chunk, leaving createOpenAI undefined at runtime. Keep it alone.
            if (id.includes('/node_modules/@ai-sdk/openai/')) return 'ai-sdk-openai'
            return undefined
          }
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        }
      },
      sourcemap: isDev
    },
    esbuild: isProd ? { legalComments: 'none' } : {},
    optimizeDeps: {
      noDiscovery: isDev
    }
  },
  preload: {
    plugins: [
      react({
        tsDecorators: true
      })
    ],
    resolve: {
      alias: {
        '@shared': resolve('src/shared')
      }
    },
    build: {
      sourcemap: isDev,
      rollupOptions: {
        // Unlike renderer which auto-discovers entries from HTML files,
        // preload requires explicit entry point configuration for multiple scripts
        input: {
          preload: resolve(__dirname, 'src/preload/preload.ts'),
          simplest: resolve(__dirname, 'src/preload/simplest.ts'), // Minimal preload
          miniApp: resolve(__dirname, 'src/preload/miniApp.ts'), // MiniApp `<webview>` guests
          miniAppBridge: resolve(__dirname, 'src/preload/miniAppBridge.ts') // Local mini app guests (`window.cherry`)
        },
        external: ['electron'],
        output: {
          entryFileNames: '[name].js',
          format: 'cjs'
        }
      }
    }
  },
  renderer: {
    define: {
      __APP_RELEASE_HISTORY__: JSON.stringify(bundledReleaseHistory),
      __APP_RELEASE_NOTES__: JSON.stringify(bundledReleaseNotes),
      __APP_RELEASE_VERSION__: JSON.stringify(pkg.version)
    },
    plugins: [
      uiContractPlugin(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve('src/renderer/routes'),
        generatedRouteTree: resolve('src/renderer/routeTree.gen.ts')
      }),
      (async () => (await import('@tailwindcss/vite')).default())(),
      react({
        tsDecorators: true
      }),
      ...(isDev ? [CodeInspectorPlugin({ bundler: 'vite' })] : []), // 只在开发环境下启用 CodeInspectorPlugin
      ...visualizerPlugin('renderer')
    ],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@logger': resolve('src/renderer/services/LoggerService'),
        '@data': resolve('src/renderer/data'),
        '@cherrystudio/ai-core/provider': resolve('packages/aiCore/src/core/providers'),
        '@cherrystudio/ai-core/built-in/plugins': resolve('packages/aiCore/src/core/plugins/built-in'),
        '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
        '@cherrystudio/extension-table-plus': resolve('packages/extension-table-plus/src'),
        '@cherrystudio/ai-sdk-provider': resolve('packages/ai-sdk-provider/src'),
        '@cherrystudio/provider-registry/node': resolve('packages/provider-registry/src/registry-loader'),
        '@cherrystudio/provider-registry': resolve('packages/provider-registry/src'),
        '@cherrystudio/ui/icons/providers': resolve('packages/ui/src/components/icons/providers'),
        '@cherrystudio/ui/icons': resolve('packages/ui/src/components/icons'),
        '@cherrystudio/ui': resolve('packages/ui/src'),
        '@test-mocks': resolve('tests/__mocks__')
      }
    },
    optimizeDeps: {
      exclude: ['pyodide'],
      esbuildOptions: {
        target: 'esnext' // for dev
      }
    },
    worker: {
      format: 'es'
    },
    build: {
      target: 'esnext', // for build
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/windows/main/index.html'),
          quickAssistant: resolve(__dirname, 'src/renderer/windows/quickAssistant/index.html'),
          selectionToolbar: resolve(__dirname, 'src/renderer/windows/selection/toolbar/index.html'),
          selectionAction: resolve(__dirname, 'src/renderer/windows/selection/action/index.html'),
          migrationV2: resolve(__dirname, 'src/renderer/windows/migrationV2/index.html'),
          userDataRelocation: resolve(__dirname, 'src/renderer/windows/userDataRelocation/index.html'),
          subWindow: resolve(__dirname, 'src/renderer/windows/subWindow/index.html'),
          screenshot: resolve(__dirname, 'src/renderer/windows/screenshot/index.html')
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        },
        output: {
          advancedChunks: {
            // Without this, groups recursively capture dependencies — React
            // itself ends up inside an icon bucket and every window preloads it.
            includeDependenciesRecursively: false,
            groups: [
              // Bucket per-icon lazy modules into mid-size chunks instead of one
              // tiny chunk per icon. Model icons only: they are reached solely
              // through the dynamic loaders, so the buckets stay off every
              // window's eager graph. Provider icons must NOT be grouped — a few
              // files statically import specific providers from
              // @cherrystudio/ui/icons/providers, and bucketing would chain
              // whole buckets of unrelated SVGs into those windows' first load.
              // Only the SVG component files (*.tsx) may match: each icon dir's
              // meta.ts is eagerly imported by the meta-catalogs.
              {
                name: 'icons-models',
                test: /packages\/ui\/src\/components\/icons\/models\/[^/]+\/(?:index|light|dark|avatar)\.tsx$/,
                maxSize: 150_000
              }
            ]
          }
        }
      }
    },
    esbuild: isProd ? { legalComments: 'none' } : {}
  }
})
