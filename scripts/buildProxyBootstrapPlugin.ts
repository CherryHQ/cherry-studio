import { builtinModules } from 'node:module'

import { resolve } from 'path'
import { build as viteBuild, type Plugin } from 'vite'

interface BuildProxyBootstrapPluginOptions {
  dependencies: string[]
  isDev: boolean
  isProd: boolean
  rootDir: string
}

export const buildProxyBootstrapPlugin = ({
  dependencies,
  isDev,
  isProd,
  rootDir
}: BuildProxyBootstrapPluginOptions): Plugin => {
  return {
    name: 'cherry-build-proxy-bootstrap',
    apply: 'build',
    async closeBundle() {
      if (isDev) return

      await viteBuild({
        configFile: false,
        publicDir: false,
        resolve: {
          mainFields: ['module', 'jsnext:main', 'jsnext'],
          conditions: ['node'],
          alias: {
            '@main': resolve(rootDir, 'src/main'),
            '@types': resolve(rootDir, 'src/renderer/src/types'),
            '@shared': resolve(rootDir, 'packages/shared'),
            '@logger': resolve(rootDir, 'src/main/services/LoggerService'),
            '@mcp-trace/trace-core': resolve(rootDir, 'packages/mcp-trace/trace-core'),
            '@mcp-trace/trace-node': resolve(rootDir, 'packages/mcp-trace/trace-node')
          }
        },
        build: {
          outDir: resolve(rootDir, 'out/proxy'),
          target: 'node22',
          minify: false,
          reportCompressedSize: false,
          copyPublicDir: false,
          lib: {
            entry: resolve(rootDir, 'src/main/services/proxy/bootstrap.ts'),
            formats: ['cjs'],
            fileName: () => 'index.js'
          },
          rollupOptions: {
            external: [
              'electron',
              /^electron\/.+/,
              ...builtinModules.flatMap((moduleName) => [moduleName, `node:${moduleName}`]),
              ...dependencies
            ]
          }
        },
        esbuild: isProd ? { legalComments: 'none' } : {}
      })
    }
  }
}
