import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { defineConfig } from 'tsdown'

type RuntimePackaging = {
  entry: Record<string, string>
  entries: Record<string, string>
  dshPackageNames: string[]
  externalPackageNames: string[]
}

const require_ = createRequire(import.meta.url)
const { discoverDshRuntimePackaging } = require_('./scripts/runtimeEntries.cjs') as {
  discoverDshRuntimePackaging: (options: { packageRoot: string; platform: null; arch: null }) => RuntimePackaging
}
const { version: dshLlmVersion } = require_('@deepseek-ai/dsh-llm/package.json') as { version: string }
const runtimePackaging = discoverDshRuntimePackaging({
  packageRoot: import.meta.dirname,
  platform: null,
  arch: null
})

const isExternalPackage = (id: string) =>
  runtimePackaging.externalPackageNames.some((name) => id === name || id.startsWith(`${name}/`))

function writeRuntimeManifest(outputDirectory: string): void {
  mkdirSync(outputDirectory, { recursive: true })
  writeFileSync(
    path.join(outputDirectory, 'runtime-manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        entries: runtimePackaging.entries,
        externalPackageNames: runtimePackaging.externalPackageNames,
        dshPackageNames: runtimePackaging.dshPackageNames
      },
      null,
      2
    )}\n`
  )
}

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
    entry: runtimePackaging.entry,
    outDir: 'dist/runtime',
    format: ['esm'],
    clean: false,
    dts: false,
    external: runtimePackaging.externalPackageNames,
    noExternal: (id) => !isExternalPackage(id),
    plugins: [
      {
        name: 'inline-dsh-llm-version',
        transform(code, id) {
          if (!/[\\/]@deepseek-ai[\\/]dsh-llm[\\/]lib[\\/]index\.js$/.test(id)) return
          const packageVersion = /createRequire\(import\.meta\.url\)\((['"])\.\.\/package\.json\1\)/
          if (!packageVersion.test(code)) throw new Error('Could not inline the DSH LLM package version')
          return code.replace(packageVersion, `({ version: ${JSON.stringify(dshLlmVersion)} })`)
        }
      },
      {
        name: 'write-dsh-runtime-manifest',
        writeBundle(outputOptions) {
          writeRuntimeManifest(outputOptions.dir ?? path.join(import.meta.dirname, 'dist/runtime'))
        }
      }
    ],
    minify: true,
    hash: false,
    tsconfig: 'tsconfig.json'
  }
])
