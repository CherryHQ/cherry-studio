import { createRequire } from 'node:module'
import path from 'node:path'

import { defineConfig } from 'tsdown'

import { DSH_RUNTIME_ENTRY_NAMES } from './src/runtimeEntries.ts'

const require_ = createRequire(import.meta.url)
const { version: dshLlmVersion } = require_('@deepseek-ai/dsh-llm/package.json') as { version: string }
const runtimeEntries = Object.fromEntries(
  Object.entries(DSH_RUNTIME_ENTRY_NAMES).map(([specifier, entryName]) => [
    entryName,
    specifier === '@cherrystudio/dsh-bridge/plugin'
      ? path.join(import.meta.dirname, 'src/plugin.ts')
      : require_.resolve(specifier)
  ])
)

// A package-local tsconfig (no project `references`) is required so
// rolldown-plugin-dts can emit declarations — the root tsconfig's `references` break it.
export default defineConfig([
  {
    entry: { index: 'src/index.ts' },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    clean: true,
    dts: true,
    tsconfig: 'tsconfig.json'
  },
  {
    // This is the complete JS runtime executed by the external dsh Node process.
    entry: runtimeEntries,
    outDir: 'dist/runtime',
    format: ['esm'],
    clean: false,
    dts: false,
    external: [
      '@deepseek-ai/dsh-sandbox-windows-acl',
      '@deepseek-ai/node-addon-landlock-run',
      'koffi',
      'node-pty',
      'sharp'
    ],
    noExternal: () => true,
    plugins: [
      {
        name: 'inline-dsh-llm-version',
        transform(code, id) {
          if (!/[\\/]@deepseek-ai[\\/]dsh-llm[\\/]lib[\\/]index\.js$/.test(id)) return
          const packageVersion = /createRequire\(import\.meta\.url\)\((["'])\.\.\/package\.json\1\)/
          if (!packageVersion.test(code)) throw new Error('Could not inline the DSH LLM package version')
          return code.replace(packageVersion, `({ version: ${JSON.stringify(dshLlmVersion)} })`)
        }
      }
    ],
    minify: true,
    hash: false,
    tsconfig: 'tsconfig.json'
  }
])
