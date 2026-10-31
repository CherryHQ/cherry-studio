import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'

import { resolveMigrationsPath } from './internal/migrationsPath'
import type { TestDatabaseHandle } from './testDatabase'

interface MigrationJournal {
  entries: Array<{ tag: string; when: number }>
}

/**
 * Re-run one shipped migration over the harness database through `applyMigrations`, as an upgrade
 * from the schema before it would, so a test can check it keeps populated rows.
 *
 * Only that migration runs. The ones after it are already applied and need not be re-runnable (an
 * `ALTER TABLE ... ADD` is not), so their journal rows are restored instead.
 */
export function replayMigration(dbh: TestDatabaseHandle, tag: string): void {
  const migrationsFolder = resolveMigrationsPath()
  const journal = JSON.parse(readFileSync(join(migrationsFolder, 'meta/_journal.json'), 'utf8')) as MigrationJournal
  const index = journal.entries.findIndex((entry) => entry.tag === tag)
  if (index === -1) {
    throw new Error(`Unknown migration: ${tag}`)
  }
  const { when } = journal.entries[index]

  const throughTag = mkdtempSync(join(tmpdir(), 'cs-test-migrations-'))
  try {
    cpSync(migrationsFolder, throughTag, { recursive: true })
    writeFileSync(
      join(throughTag, 'meta/_journal.json'),
      JSON.stringify({ ...journal, entries: journal.entries.slice(0, index + 1) })
    )

    const later = dbh.sqlite
      .prepare('SELECT hash, created_at FROM __drizzle_migrations WHERE created_at > ?')
      .all(when) as Array<{ hash: string; created_at: number }>
    dbh.sqlite.prepare('DELETE FROM __drizzle_migrations WHERE created_at >= ?').run(when)
    applyMigrations(dbh.db, throughTag)
    const restore = dbh.sqlite.prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
    for (const row of later) {
      restore.run(row.hash, row.created_at)
    }
  } finally {
    rmSync(throughTag, { recursive: true, force: true })
  }
}
