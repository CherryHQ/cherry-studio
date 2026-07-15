import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import { MESSAGE_FTS_STATEMENTS } from '@data/db/schemas/message'
import type { DbType } from '@data/db/types'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Direct tests over a throwaway file-backed DB — deliberately NOT via
 * setupTestDatabase(): the harness itself delegates to applyMigrations,
 * so these tests must not run through the code under test's consumer.
 */

// Names of the FTS objects applyMigrations must create, extracted from the
// statements themselves so a schema rename cannot silently defang the assertion.
const ftsObjectNames = MESSAGE_FTS_STATEMENTS.flatMap((statement) => {
  const match = statement.match(/CREATE (?:VIRTUAL TABLE IF NOT EXISTS|TRIGGER)\s+(\w+)/)
  return match ? [match[1]] : []
})

describe('applyMigrations', () => {
  let tempDir: string
  let sqlite: Database.Database
  let db: DbType

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-apply-migrations-'))
    sqlite = new Database(join(tempDir, 'test.db'))
    db = drizzle({ client: sqlite, casing: 'snake_case' })
  })

  afterEach(() => {
    sqlite.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('migrates an empty database to a healthy schema including FTS objects', () => {
    applyMigrations(db, resolveMigrationsPath())

    expect(String(sqlite.pragma('integrity_check', { simple: true }))).toBe('ok')

    const masterNames = (sqlite.prepare('SELECT name FROM sqlite_master').all() as Array<{ name: string }>).map(
      (row) => row.name
    )
    expect(masterNames).toContain('message')
    expect(ftsObjectNames.length).toBeGreaterThan(0)
    for (const name of ftsObjectNames) {
      expect(masterNames).toContain(name)
    }
  })

  it('is idempotent when run again on an already-migrated database', () => {
    applyMigrations(db, resolveMigrationsPath())

    expect(() => applyMigrations(db, resolveMigrationsPath())).not.toThrow()
    expect(String(sqlite.pragma('integrity_check', { simple: true }))).toBe('ok')
  })
})
