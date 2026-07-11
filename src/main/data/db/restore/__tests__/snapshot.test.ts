import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import { snapshotTo } from '@data/db/restore/snapshot'
import { appStateTable } from '@data/db/schemas/appState'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

describe('snapshotTo', () => {
  let tempDir: string
  const connections: Database.Database[] = []

  function track(db: Database.Database): Database.Database {
    connections.push(db)
    return db
  }

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-snapshot-'))
  })

  afterEach(() => {
    for (const db of connections.splice(0)) {
      try {
        db.close()
      } catch {
        // already closed by the test
      }
    }
    rmSync(tempDir, { recursive: true, force: true })
  })

  it('writes a consistent snapshot carrying rows and __drizzle_migrations', () => {
    const sqlite = track(new Database(join(tempDir, 'live.sqlite')))
    sqlite.pragma('journal_mode = WAL')
    const db = drizzle({ client: sqlite, casing: 'snake_case' })
    applyMigrations(db, resolveMigrationsPath())
    db.insert(appStateTable)
      .values([
        { key: 'snapshot-test-a', value: { n: 1 } },
        { key: 'snapshot-test-b', value: { n: 2 } }
      ])
      .run()

    const snapshotPath = join(tempDir, 'nested', 'work.sqlite')
    snapshotTo(sqlite, snapshotPath)

    const snapshot = track(new Database(snapshotPath))
    const rowCount = snapshot.prepare('SELECT COUNT(*) AS c FROM app_state').get() as { c: number }
    expect(rowCount.c).toBe(2)
    const migrationsTable = snapshot
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get()
    expect(migrationsTable).toBeDefined()
    expect(String(snapshot.pragma('integrity_check', { simple: true }))).toBe('ok')
  })

  it('throws when the target file already exists', () => {
    const sqlite = track(new Database(join(tempDir, 'live.sqlite')))
    const target = join(tempDir, 'existing.sqlite')
    writeFileSync(target, 'occupied')

    expect(() => snapshotTo(sqlite, target)).toThrow(target)
  })
})
