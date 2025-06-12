import react from '@vitejs/plugin-react-swc'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import fs from 'fs'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
        exclude: [
          '@cherrystudio/embedjs',
          '@cherrystudio/embedjs-openai',
          '@cherrystudio/embedjs-loader-web',
          '@cherrystudio/embedjs-loader-markdown',
          '@cherrystudio/embedjs-loader-msoffice',
          '@cherrystudio/embedjs-loader-xml',
          '@cherrystudio/embedjs-loader-pdf',
          '@cherrystudio/embedjs-loader-sitemap',
          '@cherrystudio/embedjs-libsql',
          '@cherrystudio/embedjs-loader-image',
          'p-queue',
          'webdav'
        ]
      }), ...visualizerPlugin('main')],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@types': resolve('src/renderer/src/types'),
        '@shared': resolve('packages/shared')
      }
    },
    build: {
      rollupOptions: {
        external: ['@libsql/client', 'bufferutil', 'utf-8-validate'],
        plugins: [
          {
            name: 'inject-windows7-polyfill',
            generateBundle(_, bundle) {
              // 遍历所有生成的文件
              for (const fileName in bundle) {
                const chunk = bundle[fileName]
                if (
                  chunk.type === 'chunk' &&
                  chunk.isEntry &&
                  chunk.fileName.includes('index.js') // 匹配主进程入口文件
                ) {
                  const code = fs.readFileSync('src/main/polyfill/windows7-patch.js', 'utf-8')
                  // 在文件末尾插入自定义代码
                  chunk.code = code + '\r\n' + chunk.code
                }
              }
            }
          }
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('packages/shared')
      }
    },
    build: {
      sourcemap: process.env.NODE_ENV === 'development'
    }
  },
  renderer: {
    define: {
      // 使用方法 (Windows CMD): set CUSTOM_APP_NAME=AppName && yarn run dev
      'process.env.CUSTOM_APP_NAME': JSON.stringify(process.env.CUSTOM_APP_NAME)
    },
    plugins: [
      react({
        plugins: [
          [
            '@swc/plugin-styled-components',
            {
              displayName: true, // 开发环境下启用组件名称
              fileName: false, // 不在类名中包含文件名
              pure: true, // 优化性能
              ssr: false // 不需要服务端渲染
            }
          ]
        ]
      }),
      ...visualizerPlugin('renderer')
    ],
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@shared': resolve('packages/shared')
      }
    },
    optimizeDeps: {
      exclude: ['pyodide']
    },
    worker: {
      format: 'es'
    },
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
          miniWindow: resolve(__dirname, 'src/renderer/miniWindow.html'),
          selectionToolbar: resolve(__dirname, 'src/renderer/selectionToolbar.html'),
          selectionAction: resolve(__dirname, 'src/renderer/selectionAction.html')
        }
      }
    }
  }
})
