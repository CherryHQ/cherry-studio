import react from '@vitejs/plugin-react'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { resolve } from 'path'
import { visualizer } from 'rollup-plugin-visualizer'

const visualizerPlugin = (type: 'renderer' | 'main') => {
  return process.env[`VISUALIZER_${type.toUpperCase()}`] ? [visualizer({ open: true })] : []
}

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
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
      }),
      ...visualizerPlugin('main')
    ],
    resolve: {
      alias: {
        '@main': resolve('src/main'),
        '@types': resolve('src/renderer/src/types'),
        '@shared': resolve('packages/shared')
      }
    },
    build: {
      rollupOptions: {
        external: ['@libsql/client']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    plugins: [
      react({
        babel: {
          plugins: [
            [
              'styled-components',
              {
                displayName: true, // 开发环境下启用组件名称
                fileName: false, // 不在类名中包含文件名
                pure: true, // 优化性能
                ssr: false // 不需要服务端渲染
              }
            ]
          ]
        }
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
      exclude: ['chunk-PZ64DZKH.js', 'chunk-JMKENWIY.js', 'chunk-UXYB6GHG.js', 'chunk-ALDIEZMG.js', 'chunk-4X6ZJEXY.js']
    }
  }
})
