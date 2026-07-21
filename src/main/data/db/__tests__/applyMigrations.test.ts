import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

interface MigrationJournal {
  dialect: string
  entries: Array<{ idx: number; tag: string }>
  version: string
}

function copyMigrationsThrough(source: string, destination: string, lastTagPrefix: string): void {
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8')) as MigrationJournal
  const lastIndex = journal.entries.findIndex((entry) => entry.tag.startsWith(lastTagPrefix))
  if (lastIndex < 0) throw new Error(`Migration ${lastTagPrefix} not found`)

  const entries = journal.entries.slice(0, lastIndex + 1)
  mkdirSync(join(destination, 'meta'), { recursive: true })
  writeFileSync(join(destination, 'meta/_journal.json'), `${JSON.stringify({ ...journal, entries }, null, 2)}\n`)
  for (const entry of entries) {
    copyFileSync(join(source, `${entry.tag}.sql`), join(destination, `${entry.tag}.sql`))
  }
}

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

  it('backfills exact Topic and Session activity when upgrading from 0023 to 0024', () => {
    const migrationsPath = resolveMigrationsPath()
    const migrationsThrough0023 = join(tempDir, 'migrations-through-0023')
    copyMigrationsThrough(migrationsPath, migrationsThrough0023, '0023_')
    applyMigrations(db, migrationsThrough0023)

    sqlite.exec(`
      INSERT INTO topic (id, name, order_key, created_at, updated_at) VALUES
        ('topic-active', 'Active', 'a0', 100, 900),
        ('topic-empty', 'Empty', 'a1', 700, 900);
      INSERT INTO message (id, parent_id, topic_id, role, data, status, created_at, updated_at, deleted_at) VALUES
        ('topic-root', NULL, 'topic-active', 'root', '{"parts":[]}', 'success', 100, 100, NULL),
        ('topic-user', 'topic-root', 'topic-active', 'user', '{"parts":[]}', 'success', 200, 900, NULL),
        ('topic-response', 'topic-user', 'topic-active', 'assistant', '{"parts":[]}', 'success', 300, 450, NULL),
        ('topic-deleted-response', 'topic-response', 'topic-active', 'assistant', '{"parts":[]}', 'success', 400, 800, 900);

      INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
        VALUES ('workspace-1', 'Workspace', '/tmp/workspace-1', 'user', 'a0', 1, 1);
      INSERT INTO agent_session (id, name, workspace_id, order_key, created_at, updated_at) VALUES
        ('session-active', 'Active', 'workspace-1', 'a0', 100, 900),
        ('session-empty', 'Empty', 'workspace-1', 'a1', 700, 900);
      INSERT INTO agent_session_message (id, session_id, role, data, status, created_at, updated_at) VALUES
        ('session-user', 'session-active', 'user', '{"parts":[]}', 'success', 200, 900),
        ('session-response', 'session-active', 'assistant', '{"parts":[]}', 'success', 300, 450),
        ('session-pending-response', 'session-active', 'assistant', '{"parts":[]}', 'pending', 400, 900);
    `)

    applyMigrations(db, migrationsPath)

    expect(
      sqlite.prepare('SELECT id, last_activity_at AS lastActivityAt FROM topic ORDER BY id').all() as Array<{
        id: string
        lastActivityAt: number
      }>
    ).toEqual([
      { id: 'topic-active', lastActivityAt: 450 },
      { id: 'topic-empty', lastActivityAt: 700 }
    ])
    expect(
      sqlite.prepare('SELECT id, last_activity_at AS lastActivityAt FROM agent_session ORDER BY id').all() as Array<{
        id: string
        lastActivityAt: number
      }>
    ).toEqual([
      { id: 'session-active', lastActivityAt: 450 },
      { id: 'session-empty', lastActivityAt: 700 }
    ])
  })
})
