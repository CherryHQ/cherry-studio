import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import { readAppliedChain } from '@data/db/restore/appliedChain'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { readMigrationFiles } from 'drizzle-orm/migrator'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('readAppliedChain', () => {
  let tempDir: string
  let sqlite: Database.Database

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-applied-chain-'))
    sqlite = new Database(join(tempDir, 'test.db'))
  })

  afterEach(() => {
    sqlite.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns exactly the bundled (folderMillis, hash) sequence after a full migrate', () => {
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    applyMigrations(db, resolveMigrationsPath())

    const applied = readAppliedChain(sqlite)
    const bundled = readMigrationFiles({ migrationsFolder: resolveMigrationsPath() }).map((m) => ({
      folderMillis: m.folderMillis,
      hash: m.hash
    }))

    expect(applied.length).toBeGreaterThan(0)
    expect(applied).toEqual(bundled)
  })

  it('throws on a database without __drizzle_migrations (never journal an unmigrated db)', () => {
    expect(() => readAppliedChain(sqlite)).toThrow(/__drizzle_migrations/)
  })
})
