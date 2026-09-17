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
      : specifier === '@cherrystudio/dsh-bridge/bin'
        ? path.join(import.meta.dirname, 'src/runtimeBin.ts')
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
        name: 'isolate-dsh-windows-sandbox',
        transform(code, id) {
          if (!/[\\/]@deepseek-ai[\\/]dsh-sandbox-local[\\/]lib[\\/]index\.js$/.test(id)) return
          // SDK 0.1.2-rc.1 statically imports Win32 bindings even on macOS/Linux.
          // Keep the ACL package external so its separate runner remains resolvable.
          const windowsImport =
            'import { AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid } from "@deepseek-ai/dsh-sandbox-windows-acl";'
          if (!code.includes(windowsImport)) throw new Error('Could not isolate the DSH Windows sandbox import')
          return code.replace(
            windowsImport,
            'const { AclWriteGrant, assertTempRootOutsideWorkspace, tempWriteSid, workspaceWriteSid } = process.platform === "win32" ? await import("@deepseek-ai/dsh-sandbox-windows-acl") : {};'
          )
        }
      },
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
