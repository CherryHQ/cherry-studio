import { builtinModules } from 'node:module'

import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'
import { build as viteBuild, type Plugin } from 'vite'

// assert not supported by biome
// import pkg from './package.json' assert { type: 'json' }
import pkg from './package.json'

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'
const externalDependencies = ['bufferutil', 'utf-8-validate', 'electron', ...Object.keys(pkg.dependencies)]
const mainAlias = {
  '@main': resolve('src/main'),
  '@types': resolve('src/renderer/src/types'),
  '@shared': resolve('packages/shared'),
  '@logger': resolve('src/main/services/LoggerService'),
  '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
  '@mcp-trace/trace-node': resolve('packages/mcp-trace/trace-node')
}

const buildProxyBootstrapPlugin = (): Plugin => {
  let isBuildingProxyBootstrap = false
  let shouldRebuildProxyBootstrap = false

  const buildProxyBootstrap = async () => {
    if (isBuildingProxyBootstrap) {
      shouldRebuildProxyBootstrap = true
      return
    }

    isBuildingProxyBootstrap = true

    try {
      do {
        shouldRebuildProxyBootstrap = false
        await viteBuild({
          configFile: false,
          publicDir: false,
          resolve: {
            mainFields: ['module', 'jsnext:main', 'jsnext'],
            conditions: ['node'],
            alias: mainAlias
          },
          build: {
            outDir: resolve(__dirname, 'out/proxy'),
            target: 'node22',
            minify: false,
            sourcemap: isDev,
            reportCompressedSize: false,
            copyPublicDir: false,
            lib: {
              entry: resolve(__dirname, 'src/main/services/proxy/bootstrap.ts'),
              formats: ['cjs'],
              fileName: () => 'index.js'
            },
            rollupOptions: {
              external: [
                'electron',
                /^electron\/.+/,
                ...builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
                ...Object.keys(pkg.dependencies)
              ]
            }
          },
          esbuild: isProd ? { legalComments: 'none' } : {}
        })
      } while (shouldRebuildProxyBootstrap)
    } finally {
      isBuildingProxyBootstrap = false
    }
  }

  return {
    name: 'cherry-build-proxy-bootstrap',
    apply: 'build',
    async writeBundle() {
      await buildProxyBootstrap()
    }
  }
}

export default defineConfig({
  main: {
    plugins: [...visualizerPlugin('main'), buildProxyBootstrapPlugin()],
    resolve: {
      alias: mainAlias
    },
    build: {
      rollupOptions: {
        external: externalDependencies,
        output: {
          manualChunks: undefined, // 彻底禁用代码分割 - 返回 null 强制单文件打包
          inlineDynamicImports: true // 内联所有动态导入，这是关键配置
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
        '@shared': resolve('packages/shared'),
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core')
      }
    },
    build: {
      sourcemap: isDev
    }
  },
  renderer: {
    plugins: [
      (async () => (await import('@tailwindcss/vite')).default())(),
      react({
        tsDecorators: true
      }),
      ...(isDev ? [CodeInspectorPlugin({ bundler: 'vite' })] : []), // 只在开发环境下启用 CodeInspectorPlugin
      ...visualizerPlugin('renderer')
    ],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('packages/shared'),
        '@types': resolve('src/renderer/src/types'),
        '@logger': resolve('src/renderer/src/services/LoggerService'),
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
        '@mcp-trace/trace-web': resolve('packages/mcp-trace/trace-web'),
        '@cherrystudio/ai-core/provider': resolve('packages/aiCore/src/core/providers'),
        '@cherrystudio/ai-core/built-in/plugins': resolve('packages/aiCore/src/core/plugins/built-in'),
        '@cherrystudio/ai-core': resolve('packages/aiCore/src'),
        '@cherrystudio/extension-table-plus': resolve('packages/extension-table-plus/src'),
        '@cherrystudio/ai-sdk-provider': resolve('packages/ai-sdk-provider/src')
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
          index: resolve(__dirname, 'src/renderer/index.html'),
          miniWindow: resolve(__dirname, 'src/renderer/miniWindow.html'),
          selectionToolbar: resolve(__dirname, 'src/renderer/selectionToolbar.html'),
          selectionAction: resolve(__dirname, 'src/renderer/selectionAction.html'),
          traceWindow: resolve(__dirname, 'src/renderer/traceWindow.html')
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          warn(warning)
        }
      }
    },
    esbuild: isProd ? { legalComments: 'none' } : {}
  }
})
