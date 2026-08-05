import { resolve } from 'path'

import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { visualizer } from 'rollup-plugin-visualizer'

// Import attributes are not supported by the current Electron config loader.
// import pkg from './package.json' assert { type: 'json' }
import pkg from './package.json'
import { uiContractPlugin } from './scripts/uiContract/vitePlugin'

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

// Bundle/externalize split for the main process: everything in `dependencies` is
// externalized through electron-vite below (kept in node_modules of the packaged app), and everything
// NOT in `dependencies` (i.e. in `devDependencies`) is bundled into the main bundle by
// Rolldown. The API gateway's Elysia stack (`elysia`, `@elysia/*`) is intentionally in
// `devDependencies` for exactly this reason — it is pure JS and bundles cleanly. Do NOT
// move it to `dependencies`: that would externalize it, and since devDependencies are
// pruned from production packages, the packaged app would fail at runtime with
// MODULE_NOT_FOUND (no test catches this). See docs/references/api-gateway/README.md.
const mainExternalDependencies = Object.keys(pkg.dependencies)
const mainExternalModules = ['bufferutil', 'utf-8-validate', 'electron', ...mainExternalDependencies]

// Mirrors electron-vite's dependency externalization so the bundle boundary can
// be pinned without coupling tests to plugin internals.
export const isMainExternalModule = (id: string) => {
  return mainExternalModules.some((moduleId) => id === moduleId || id.startsWith(`${moduleId}/`))
}

export default defineConfig({
  main: {
    plugins: [...visualizerPlugin('main')],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@application': resolve('src/main/core/application/Application'),
        '@data': resolve('src/main/data'),
        '@shared': resolve('src/shared'),
        '@logger': resolve('src/main/core/logger/LoggerService'),
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
        '@mcp-trace/trace-node': resolve('packages/mcp-trace/trace-node'),
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
      externalizeDeps: {
        include: ['bufferutil', 'utf-8-validate']
      },
      lib: { entry: resolve(__dirname, 'src/main/main.ts') },
      rolldownOptions: {
        output: {
          codeSplitting: false, // 内联所有动态导入，这是关键配置
          comments: isProd ? { legal: false } : undefined
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        }
      },
      sourcemap: isDev
    },
    optimizeDeps: {
      noDiscovery: isDev
    }
  },
  preload: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core')
      }
    },
    build: {
      sourcemap: isDev,
      rolldownOptions: {
        // Unlike renderer which auto-discovers entries from HTML files,
        // preload requires explicit entry point configuration for multiple scripts
        input: {
          preload: resolve(__dirname, 'src/preload/preload.ts'),
          simplest: resolve(__dirname, 'src/preload/simplest.ts') // Minimal preload
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
    plugins: [
      uiContractPlugin(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve('src/renderer/routes'),
        generatedRouteTree: resolve('src/renderer/routeTree.gen.ts'),
        routeTreeFileHeader: ['/* oxlint-disable */', '// @ts-nocheck', '// noinspection JSUnusedGlobalSymbols']
      }),
      tailwindcss(),
      react(),
      ...(isDev ? [CodeInspectorPlugin({ bundler: 'vite' })] : []), // 只在开发环境下启用 CodeInspectorPlugin
      ...visualizerPlugin('renderer')
    ],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer'),
        '@shared': resolve('src/shared'),
        '@logger': resolve('src/renderer/services/LoggerService'),
        '@data': resolve('src/renderer/data'),
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
        '@cherrystudio/ai-core/provider': resolve('packages/aiCore/src/core/providers'),
        '@cherrystudio/ai-core/built-in/plugins': resolve('packages/aiCore/src/core/plugins/built-in'),
        '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
        '@cherrystudio/extension-table-plus': resolve('packages/extension-table-plus/src'),
        '@cherrystudio/ai-sdk-provider': resolve('packages/ai-sdk-provider/src'),
        '@cherrystudio/provider-registry/node': resolve('packages/provider-registry/src/registry-loader'),
        '@cherrystudio/provider-registry': resolve('packages/provider-registry/src'),
        '@cherrystudio/ui/icons': resolve('packages/ui/src/components/icons'),
        '@cherrystudio/ui': resolve('packages/ui/src'),
        '@test-mocks': resolve('tests/__mocks__')
      }
    },
    optimizeDeps: {
      exclude: ['pyodide'],
      rolldownOptions: {
        transform: {
          target: 'esnext' // for dev
        }
      }
    },
    worker: {
      format: 'es'
    },
    build: {
      target: 'esnext', // for build
      rolldownOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/windows/main/index.html'),
          quickAssistant: resolve(__dirname, 'src/renderer/windows/quickAssistant/index.html'),
          selectionToolbar: resolve(__dirname, 'src/renderer/windows/selection/toolbar/index.html'),
          selectionAction: resolve(__dirname, 'src/renderer/windows/selection/action/index.html'),
          migrationV2: resolve(__dirname, 'src/renderer/windows/migrationV2/index.html'),
          userDataRelocation: resolve(__dirname, 'src/renderer/windows/userDataRelocation/index.html'),
          subWindow: resolve(__dirname, 'src/renderer/windows/subWindow/index.html')
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        },
        output: {
          comments: isProd ? { legal: false } : undefined
        }
      }
    }
  }
})
