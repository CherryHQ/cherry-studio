import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

// assert not supported by biome
// import pkg from './package.json' assert { type: 'json' }
import pkg from './package.json'

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

const buildTimeEnvVars = {
  'process.env.ENABLE_TEST_PLAN': JSON.stringify(process.env.ENABLE_TEST_PLAN || 'true'),
  'process.env.APP_NAME': JSON.stringify(process.env.APP_NAME || 'Cherry Studio'),
  'process.env.APP_DESCRIPTION': JSON.stringify(process.env.APP_DESCRIPTION || 'A powerful AI assistant for producer.'),
  'process.env.APP_ID': JSON.stringify(process.env.APP_ID || 'com.kangfenmao.CherryStudio'),
  'process.env.APP_AUTHOR': JSON.stringify(process.env.APP_AUTHOR || 'support@cherry-ai.com'),
  'process.env.APP_HOMEPAGE': JSON.stringify(process.env.APP_HOMEPAGE || 'https://github.com/CherryHQ/cherry-studio'),
  'process.env.APP_PROTOCOL': JSON.stringify(process.env.APP_PROTOCOL || 'cherrystudio'),
  'process.env.CUSTOM_BUILD': JSON.stringify(process.env.CUSTOM_BUILD === 'true'),
  'process.env.BUILD_BRAND': JSON.stringify(process.env.BUILD_BRAND || 'default'),
  'process.env.SOURCE_CODE_URL': JSON.stringify(
    process.env.SOURCE_CODE_URL || 'https://github.com/CherryHQ/cherry-studio'
  ),
  'process.env.CONTACT_EMAIL': JSON.stringify(process.env.CONTACT_EMAIL || 'support@cherry-ai.com'),
  'process.env.SHOW_DOCS': JSON.stringify(process.env.SHOW_DOCS !== 'false'),
  'process.env.SHOW_WEBSITE': JSON.stringify(process.env.SHOW_WEBSITE !== 'false'),
  'process.env.SHOW_ENTERPRISE': JSON.stringify(process.env.SHOW_ENTERPRISE !== 'false'),
  'process.env.SHOW_CAREERS': JSON.stringify(process.env.SHOW_CAREERS !== 'false'),
  'process.env.GITHUB_REPO_URL': JSON.stringify(
    process.env.GITHUB_REPO_URL || 'https://github.com/CherryHQ/cherry-studio'
  ),
  'process.env.UPDATE_SERVER_URL': JSON.stringify(process.env.UPDATE_SERVER_URL || ''),
  'process.env.UPDATE_CONFIG_URL': JSON.stringify(process.env.UPDATE_CONFIG_URL || ''),
  'process.env.UPDATE_FEED_URL': JSON.stringify(process.env.UPDATE_FEED_URL || ''),
  'process.env.UPDATE_MIRROR': JSON.stringify(process.env.UPDATE_MIRROR || 'github')
}

export default defineConfig({
  main: {
    plugins: [...visualizerPlugin('main')],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@types': resolve('src/renderer/src/types'),
        '@shared': resolve('packages/shared'),
        '@logger': resolve('src/main/services/LoggerService'),
        '@mcp-trace/trace-core': resolve('packages/mcp-trace/trace-core'),
        '@mcp-trace/trace-node': resolve('packages/mcp-trace/trace-node')
      }
    },
    build: {
      rollupOptions: {
        external: ['bufferutil', 'utf-8-validate', 'electron', ...Object.keys(pkg.dependencies)],
        output: {
          manualChunks: undefined, // 彻底禁用代码分割 - 返回 null 强制单文件打包
          inlineDynamicImports: true // 内联所有动态导入，这是关键配置
        },
        onwarn(warning, warn) {
          if (warning.code === 'COMMONJS_VARIABLE_IN_ESM') return
          // Filter out code-inspector-plugin path module externalization warnings
          if (warning.code === 'MODULE_EXTERNALIZATION' && warning.message?.includes('path')) return
          warn(warning)
        }
      },
      sourcemap: isDev
    },
    esbuild: isProd ? { legalComments: 'none' } : {},
    optimizeDeps: {
      noDiscovery: isDev
    },
    define: buildTimeEnvVars
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
        // Provide browser-compatible path module stub to prevent externalization warnings
        path: resolve('src/renderer/src/utils/path-stub.ts'),
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
    // In development mode with custom brand, serve assets from build directory
    publicDir: process.env.CUSTOM_BUILD === 'true' ? 'build' : 'resources',
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
          // Filter out code-inspector-plugin path module externalization warnings
          if (warning.code === 'MODULE_EXTERNALIZATION' && warning.message?.includes('path')) return
          warn(warning)
        }
      }
    },
    define: buildTimeEnvVars,
    esbuild: isProd ? { legalComments: 'none' } : {}
  }
})
