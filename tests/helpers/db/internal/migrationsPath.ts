import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Absolute path to the production Drizzle migrations folder.
 *
 * Resolved relative to this module's own location so it works under Vitest's
 * `transform`-based module runner — hardcoded `process.cwd()` is unreliable
 * when tests run from different working directories.
 */
export function resolveMigrationsPath(): string {
  const thisFile = fileURLToPath(import.meta.url)
  const thisDir = dirname(thisFile)
  // tests/helpers/db/internal/migrationsPath.ts → repo root is 4 levels up
  return resolve(thisDir, '../../../../migrations/sqlite-drizzle')
}

/** Copy the real migration chain strictly before `before` into an isolated fixture folder. */
export function copyMigrationPrefix(destination: string, before: string): string {
  const source = resolveMigrationsPath()
  const journal = JSON.parse(readFileSync(resolve(source, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string }[]
  }
  const end = journal.entries.findIndex((entry) => entry.tag === before)
  if (end < 0) throw new Error(`Unknown migration: ${before}`)
  const entries = journal.entries.slice(0, end)
  mkdirSync(resolve(destination, 'meta'), { recursive: true })
  for (const { tag } of entries) copyFileSync(resolve(source, `${tag}.sql`), resolve(destination, `${tag}.sql`))
  writeFileSync(resolve(destination, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }))
  return destination
}
