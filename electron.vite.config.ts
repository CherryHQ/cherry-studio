import react from '@vitejs/plugin-react-swc'
import { CodeInspectorPlugin } from 'code-inspector-plugin'
import { defineConfig } from 'electron-vite'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'
import type { Plugin } from 'vite'

// Plugin to inject brand constants at build time for main and renderer process
// This ensures brand values are baked into the bundled code
function brandConstantsPlugin(): Plugin {
  return {
    name: 'brand-constants',
    enforce: 'post',
    transform(code, id) {
      // Transform build-constants.ts in both main and renderer
      if (!id.includes('build-constants')) {
        return null
      }

      // Get the actual environment values at build time
      const replacements: Record<string, string> = {
        ENABLE_TEST_PLAN: process.env.ENABLE_TEST_PLAN || 'true',
        APP_NAME: process.env.APP_NAME || 'Cherry Studio',
        APP_DESCRIPTION: process.env.APP_DESCRIPTION || 'A powerful AI assistant for producer.',
        APP_ID: process.env.APP_ID || 'com.kangfenmao.CherryStudio',
        APP_AUTHOR: process.env.APP_AUTHOR || 'support@cherry-ai.com',
        APP_HOMEPAGE: process.env.APP_HOMEPAGE || 'https://github.com/CherryHQ/cherry-studio',
        APP_PROTOCOL: process.env.APP_PROTOCOL || 'cherrystudio',
        CUSTOM_BUILD: process.env.CUSTOM_BUILD || 'false',
        BUILD_BRAND: process.env.BUILD_BRAND || 'default',
        SOURCE_CODE_URL: process.env.SOURCE_CODE_URL || 'https://github.com/CherryHQ/cherry-studio',
        CONTACT_EMAIL: process.env.CONTACT_EMAIL || 'support@cherry-ai.com',
        SHOW_DOCS: process.env.SHOW_DOCS || 'true',
        SHOW_WEBSITE: process.env.SHOW_WEBSITE || 'true',
        SHOW_ENTERPRISE: process.env.SHOW_ENTERPRISE || 'true',
        SHOW_CAREERS: process.env.SHOW_CAREERS || 'true',
        GITHUB_REPO_URL: process.env.GITHUB_REPO_URL || 'https://github.com/CherryHQ/cherry-studio',
        UPDATE_SERVER_URL: process.env.UPDATE_SERVER_URL || '',
        UPDATE_CONFIG_URL: process.env.UPDATE_CONFIG_URL || '',
        UPDATE_FEED_URL: process.env.UPDATE_FEED_URL || '',
        UPDATE_MIRROR: process.env.UPDATE_MIRROR || 'github'
      }

      // Boolean keys that use getEnvBool
      const boolKeys = [
        'ENABLE_TEST_PLAN',
        'CUSTOM_BUILD',
        'SHOW_DOCS',
        'SHOW_WEBSITE',
        'SHOW_ENTERPRISE',
        'SHOW_CAREERS'
      ]

      let transformedCode = code
      let replacementCount = 0

      // Replace getEnv and getEnvBool calls with actual values
      for (const [key, value] of Object.entries(replacements)) {
        const isBool = boolKeys.includes(key)

        // For boolean values, replace getEnvBool calls
        if (isBool) {
          const boolRegex = new RegExp(`getEnvBool\\(['"\`]${key}['"\`],\\s*[^)]*\\)`, 'g')
          const before = transformedCode
          // Convert string 'true'/'false' to boolean literal
          const boolValue = value === 'true'
          transformedCode = transformedCode.replace(boolRegex, String(boolValue))
          if (before !== transformedCode) {
            replacementCount++
          }
        }

        // For string values, replace getEnv calls
        const stringRegex = new RegExp(`getEnv\\(['"\`]${key}['"\`],\\s*[^)]*\\)`, 'g')
        const before = transformedCode
        transformedCode = transformedCode.replace(stringRegex, JSON.stringify(value))
        if (before !== transformedCode) {
          replacementCount++
        }
      }

      // Log if any replacements were made
      if (replacementCount > 0) {
        console.log(
          `[brand-constants] Injected ${replacementCount} brand values for: ${replacements.BUILD_BRAND} (${id})`
        )
      }

      return {
        code: transformedCode,
        map: null
      }
    }
  }
}

// assert not supported by biome
// import pkg from './package.json' assert { type: 'json' }
import pkg from './package.json'

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

const isDev = process.env.NODE_ENV === 'development'
const isProd = process.env.NODE_ENV === 'production'

// Helper function to get build-time env var with fallback
const getBuildEnv = (key: string, fallback: string) => {
  const value = process.env[key]
  // Check if this is a brand build - if BUILD_BRAND is set but the specific key is not,
  // we should use the fallback to ensure brand defaults are used
  if (value !== undefined) {
    return value
  }
  return fallback
}

// IMPORTANT: Build-time environment variables must be set BEFORE running electron-vite build
// For brand builds, use: node scripts/brand-builder.js <brand> --build
const buildTimeEnvVars = {
  'process.env.ENABLE_TEST_PLAN': JSON.stringify(getBuildEnv('ENABLE_TEST_PLAN', 'true')),
  'process.env.APP_NAME': JSON.stringify(getBuildEnv('APP_NAME', 'Cherry Studio')),
  'process.env.APP_DESCRIPTION': JSON.stringify(
    getBuildEnv('APP_DESCRIPTION', 'A powerful AI assistant for producer.')
  ),
  'process.env.APP_ID': JSON.stringify(getBuildEnv('APP_ID', 'com.kangfenmao.CherryStudio')),
  'process.env.APP_AUTHOR': JSON.stringify(getBuildEnv('APP_AUTHOR', 'support@cherry-ai.com')),
  'process.env.APP_HOMEPAGE': JSON.stringify(getBuildEnv('APP_HOMEPAGE', 'https://github.com/CherryHQ/cherry-studio')),
  'process.env.APP_PROTOCOL': JSON.stringify(getBuildEnv('APP_PROTOCOL', 'cherrystudio')),
  'process.env.CUSTOM_BUILD': JSON.stringify(getBuildEnv('CUSTOM_BUILD', 'false') === 'true'),
  'process.env.BUILD_BRAND': JSON.stringify(getBuildEnv('BUILD_BRAND', 'default')),
  'process.env.SOURCE_CODE_URL': JSON.stringify(
    getBuildEnv('SOURCE_CODE_URL', 'https://github.com/CherryHQ/cherry-studio')
  ),
  'process.env.CONTACT_EMAIL': JSON.stringify(getBuildEnv('CONTACT_EMAIL', 'support@cherry-ai.com')),
  'process.env.SHOW_DOCS': JSON.stringify(getBuildEnv('SHOW_DOCS', 'true') !== 'false'),
  'process.env.SHOW_WEBSITE': JSON.stringify(getBuildEnv('SHOW_WEBSITE', 'true') !== 'false'),
  'process.env.SHOW_ENTERPRISE': JSON.stringify(getBuildEnv('SHOW_ENTERPRISE', 'true') !== 'false'),
  'process.env.SHOW_CAREERS': JSON.stringify(getBuildEnv('SHOW_CAREERS', 'true') !== 'false'),
  'process.env.GITHUB_REPO_URL': JSON.stringify(
    getBuildEnv('GITHUB_REPO_URL', 'https://github.com/CherryHQ/cherry-studio')
  ),
  'process.env.UPDATE_SERVER_URL': JSON.stringify(getBuildEnv('UPDATE_SERVER_URL', '')),
  'process.env.UPDATE_CONFIG_URL': JSON.stringify(getBuildEnv('UPDATE_CONFIG_URL', '')),
  'process.env.UPDATE_FEED_URL': JSON.stringify(getBuildEnv('UPDATE_FEED_URL', '')),
  'process.env.UPDATE_MIRROR': JSON.stringify(getBuildEnv('UPDATE_MIRROR', 'github'))
}

export default defineConfig({
  main: {
    plugins: [...visualizerPlugin('main'), brandConstantsPlugin()],
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
      ...visualizerPlugin('renderer'),
      brandConstantsPlugin()
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
    publicDir: 'resources',
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
