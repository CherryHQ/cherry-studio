import { isBuiltin } from 'node:module'
import { resolve } from 'node:path'

import { readMigrationFiles } from 'drizzle-orm/migrator'
import { defineConfig, type Plugin } from 'vite'

const repoRoot = resolve(import.meta.dirname, '../..')
const runtime = (file: string) => resolve(import.meta.dirname, 'src/runtime', file)

/**
 * Main-process modules the data services import, swapped for browser implementations.
 * Anything not listed here must already be browser-safe; the build fails otherwise.
 */
export const workerAliases = [
  { find: /^@application$/, replacement: runtime('application.ts') },
  { find: /^@logger$/, replacement: runtime('logger.ts') },
  { find: /^@main\/core\/diagnostics$/, replacement: runtime('diagnostics.ts') },
  { find: /^@main\/core\/platform$/, replacement: runtime('platform.ts') },
  { find: /^node:crypto$/, replacement: runtime('nodeCrypto.ts') },
  { find: /^node:util$/, replacement: runtime('nodeUtil.ts') },
  { find: /^better-sqlite3$/, replacement: runtime('betterSqlite3.ts') },
  {
    find: /^drizzle-orm\/better-sqlite3\/migrator$/,
    replacement: resolve(import.meta.dirname, 'src/database/migrator.ts')
  },
  { find: /^@data\//, replacement: `${resolve(repoRoot, 'src/main/data')}/` },
  { find: /^@main\//, replacement: `${resolve(repoRoot, 'src/main')}/` },
  { find: /^@shared\//, replacement: `${resolve(repoRoot, 'src/shared')}/` }
]

const MIGRATIONS_ID = 'virtual:cherry-studio-migrations'

/** Bundles the desktop migration chain, read with drizzle's own reader so hashes match the desktop. */
function migrationsPlugin(): Plugin {
  return {
    name: 'cherry-studio-migrations',
    resolveId: (id) => (id === MIGRATIONS_ID ? `\0${MIGRATIONS_ID}` : undefined),
    load(id) {
      if (id !== `\0${MIGRATIONS_ID}`) return undefined
      const migrationsFolder = resolve(repoRoot, 'migrations/sqlite-drizzle')
      this.addWatchFile(migrationsFolder)
      return `export default ${JSON.stringify(readMigrationFiles({ migrationsFolder }))}`
    }
  }
}

/**
 * Vite only warns when a browser build imports a Node built-in and the import then
 * fails at runtime. Fail the build instead, so a data service that starts using one
 * needs a replacement above before it can ship to the Worker.
 */
function forbidNodeModules(): Plugin {
  return {
    name: 'forbid-node-modules',
    enforce: 'pre',
    resolveId(id, importer) {
      if (isBuiltin(id) || id === 'electron' || id.endsWith('.node')) {
        this.error(`"${id}" (imported by ${importer}) has no browser replacement; add one to workerAliases`)
      }
      return undefined
    }
  }
}

// The non-pooled OPFS VFS needs SharedArrayBuffer, i.e. a cross-origin-isolated page.
const crossOriginIsolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp'
}

export default defineConfig({
  root: resolve(import.meta.dirname, 'harness'),
  resolve: { alias: workerAliases },
  plugins: [forbidNodeModules(), migrationsPlugin()],
  worker: { format: 'es', plugins: () => [forbidNodeModules(), migrationsPlugin()] },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  server: { headers: crossOriginIsolation },
  preview: { headers: crossOriginIsolation },
  build: {
    outDir: resolve(import.meta.dirname, 'dist/harness'),
    emptyOutDir: true,
    target: 'es2022',
    reportCompressedSize: true
  }
})
