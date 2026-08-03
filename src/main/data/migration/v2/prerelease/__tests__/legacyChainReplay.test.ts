import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import { readChainMarker, replayLegacyChain } from '@data/migration/v2/prerelease/legacyChainReplay'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Direct tests over throwaway file-backed databases — deliberately NOT via
 * setupTestDatabase(), which hands back a database already on the current
 * chain. The whole point here is a database that is *not*.
 */

const CURRENT_MIGRATIONS = resolveMigrationsPath()
const LEGACY_MIGRATIONS = resolve(CURRENT_MIGRATIONS, '../sqlite-drizzle-legacy')

/** Where alpha.1 stopped — the earliest published pre-release, so the deepest replay. */
const ALPHA_1_STEPS = 15

interface JournalEntry {
  tag: string
  when: number
}

function journalEntries(folder: string): JournalEntry[] {
  const parsed = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf-8')) as {
    entries: JournalEntry[]
  }
  return [...parsed.entries].sort((a, b) => a.when - b.when)
}

function execMigrationFile(sqlite: Database.Database, folder: string, tag: string): void {
  const sql = readFileSync(join(folder, `${tag}.sql`), 'utf-8')
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim()
    if (trimmed) sqlite.exec(trimmed)
  }
}

/**
 * Structural identity of a database, insensitive to physical column order.
 *
 * Order is excluded on purpose: replaying incremental steps appends columns as
 * they were introduced, while a regenerated migration emits them in schema
 * order. Every statement drizzle generates names its columns, so the difference
 * is unobservable — asserting on it would fail for a non-problem.
 */
function schemaFingerprint(sqlite: Database.Database): Record<string, unknown> {
  const tables = sqlite
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)
    .all() as Array<{ name: string }>

  const fingerprint: Record<string, unknown> = {}
  for (const { name } of tables) {
    if (name === '__drizzle_migrations') continue

    const columns = (sqlite.prepare(`PRAGMA table_info(\`${name}\`)`).all() as Array<Record<string, unknown>>)
      .map((c) => `${c.name}|${c.type}|notnull=${c.notnull}|default=${c.dflt_value}|pk=${c.pk}`)
      .sort()

    const foreignKeys = (sqlite.prepare(`PRAGMA foreign_key_list(\`${name}\`)`).all() as Array<Record<string, unknown>>)
      .map((f) => `${f.from}->${f.table}.${f.to}|delete=${f.on_delete}|update=${f.on_update}`)
      .sort()

    const indexes = (sqlite.prepare(`PRAGMA index_list(\`${name}\`)`).all() as Array<Record<string, unknown>>)
      .map((i) => {
        const cols = (sqlite.prepare(`PRAGMA index_info(\`${i.name}\`)`).all() as Array<{ name: string }>)
          .map((c) => c.name)
          .join(',')
        return `${i.name}|unique=${i.unique}|origin=${i.origin}|(${cols})`
      })
      .sort()

    // Table-recreate steps leave check constraints qualified by the scratch
    // table name (`__new_x`.`col`); normalize so that is not read as a diff.
    const createSql = (sqlite.prepare(`SELECT sql FROM sqlite_master WHERE name = ?`).get(name) as { sql: string }).sql
    const checks = (createSql.match(/CONSTRAINT\s+"?\w+"?\s+CHECK\([\s\S]*?\)\s*(?=,\n|\n\))/gi) ?? [])
      .map((c) =>
        c
          .replace(/[`"]/g, '')
          .replace(/__new_\w+\./g, '')
          .replace(/\s+/g, ' ')
          .trim()
      )
      .sort()

    fingerprint[name] = { columns, foreignKeys, indexes, checks }
  }
  return fingerprint
}

describe('legacyChainReplay', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'legacy-chain-'))
  })

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true })
  })

  /**
   * Builds the database an alpha/beta install would be holding: the legacy chain
   * applied up to `steps`, with the bookkeeping drizzle would have written.
   */
  function buildPrereleaseDatabase(steps: number): { file: string; sqlite: Database.Database } {
    const file = join(tempDir, 'cherrystudio.sqlite')
    const sqlite = new Database(file)
    sqlite.pragma('foreign_keys = OFF')

    const applied = journalEntries(LEGACY_MIGRATIONS).slice(0, steps)
    for (const entry of applied) execMigrationFile(sqlite, LEGACY_MIGRATIONS, entry.tag)

    sqlite.exec(`CREATE TABLE __drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`)
    const insert = sqlite.prepare(`INSERT INTO __drizzle_migrations ("hash", "created_at") VALUES (?, ?)`)
    for (const entry of applied) insert.run(`legacy-${entry.tag}`, entry.when)

    return { file, sqlite }
  }

  function seedUserData(sqlite: Database.Database): void {
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO knowledge_base (id, name, status, error, chunk_size, chunk_overlap, search_mode, created_at, updated_at)
         VALUES (?, ?, 'failed', 'not indexed', 1000, 100, 'vector', ?, ?)`
      )
      .run('kb1', 'Base', now, now)

    const insertItem = sqlite.prepare(
      `INSERT INTO knowledge_item (id, base_id, type, data, status, created_at, updated_at)
       VALUES (?, 'kb1', 'note', '{}', 'idle', ?, ?)`
    )
    for (let i = 0; i < 50; i++) insertItem.run(`item${i}`, now, now)

    sqlite
      .prepare(`INSERT INTO topic (id, name, order_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`)
      .run('t1', 'Topic', 'a0', now, now)

    const insertMessage = sqlite.prepare(
      `INSERT INTO message (id, topic_id, role, parent_id, data, status, created_at, updated_at)
       VALUES (?, 't1', ?, ?, '{}', 'success', ?, ?)`
    )
    insertMessage.run('mroot', 'root', null, now, now)
    for (let i = 0; i < 200; i++) insertMessage.run(`m${i}`, i % 2 ? 'assistant' : 'user', 'mroot', now, now)
  }

  const rowCounts = (sqlite: Database.Database) => ({
    knowledgeItems: (sqlite.prepare(`SELECT count(*) AS c FROM knowledge_item`).get() as { c: number }).c,
    messages: (sqlite.prepare(`SELECT count(*) AS c FROM message`).get() as { c: number }).c,
    topics: (sqlite.prepare(`SELECT count(*) AS c FROM topic`).get() as { c: number }).c
  })

  const replay = (file: string) =>
    replayLegacyChain({
      databaseFile: file,
      legacyMigrationsFolder: LEGACY_MIGRATIONS,
      migrationsFolder: CURRENT_MIGRATIONS
    })

  /**
   * The invariant the whole adoption rests on. Stamping a database with the
   * current chain's first-migration marker claims its schema is what that
   * migration would have produced; if a future consolidation breaks that, every
   * adopted database silently skips real schema changes. Fail here instead.
   */
  it('ends the legacy chain in the same shape as the current chain begins', () => {
    const legacy = new Database(join(tempDir, 'legacy.sqlite'))
    legacy.pragma('foreign_keys = OFF')
    for (const entry of journalEntries(LEGACY_MIGRATIONS)) {
      execMigrationFile(legacy, LEGACY_MIGRATIONS, entry.tag)
    }

    const current = new Database(join(tempDir, 'current.sqlite'))
    current.pragma('foreign_keys = OFF')
    execMigrationFile(current, CURRENT_MIGRATIONS, journalEntries(CURRENT_MIGRATIONS)[0].tag)

    expect(schemaFingerprint(legacy)).toEqual(schemaFingerprint(current))

    legacy.close()
    current.close()
  })

  it('advances a mid-chain database without losing rows', () => {
    const { file, sqlite } = buildPrereleaseDatabase(ALPHA_1_STEPS)
    seedUserData(sqlite)
    const before = rowCounts(sqlite)
    sqlite.close()

    const applied = replay(file)
    expect(applied).toBe(journalEntries(LEGACY_MIGRATIONS).length - ALPHA_1_STEPS)

    const reopened = new Database(file)
    expect(rowCounts(reopened)).toEqual(before)
    expect(reopened.prepare(`PRAGMA foreign_key_check`).all()).toEqual([])
    reopened.close()
  })

  it('leaves the bookkeeping the current chain expects', () => {
    const { file, sqlite } = buildPrereleaseDatabase(ALPHA_1_STEPS)
    sqlite.close()

    replay(file)

    const reopened = new Database(file)
    const rows = reopened.prepare(`SELECT hash, created_at FROM __drizzle_migrations`).all() as Array<{
      hash: string
      created_at: number
    }>
    reopened.close()

    const marker = readChainMarker(CURRENT_MIGRATIONS)
    expect(rows).toEqual([{ hash: marker.hash, created_at: marker.createdAt }])
  })

  it('hands over cleanly to the current chain', () => {
    const { file, sqlite } = buildPrereleaseDatabase(ALPHA_1_STEPS)
    seedUserData(sqlite)
    const before = rowCounts(sqlite)
    sqlite.close()

    replay(file)

    // What the next boot does. It must apply the appended migrations only —
    // re-running the regenerated initial migration would throw "already exists".
    const reopened = new Database(file)
    expect(() => applyMigrations(drizzle({ client: reopened, casing: 'snake_case' }), CURRENT_MIGRATIONS)).not.toThrow()
    expect(rowCounts(reopened)).toEqual(before)
    reopened.close()
  })

  it('is resumable: a database already carrying the marker is left alone', () => {
    const { file, sqlite } = buildPrereleaseDatabase(ALPHA_1_STEPS)
    sqlite.close()

    expect(replay(file)).toBeGreaterThan(0)
    // Mirrors a crash between the replay and the file move: the next launch
    // must find nothing left to do rather than replay a second time.
    expect(replay(file)).toBe(0)
  })

  it('applies nothing for a database already at the end of the legacy chain', () => {
    const { file, sqlite } = buildPrereleaseDatabase(journalEntries(LEGACY_MIGRATIONS).length)
    sqlite.close()

    expect(replay(file)).toBe(0)
  })

  it('refuses a database that carries no bookkeeping at all', () => {
    const file = join(tempDir, 'foreign.sqlite')
    const sqlite = new Database(file)
    sqlite.exec(`CREATE TABLE unrelated (id TEXT PRIMARY KEY)`)
    sqlite.close()

    expect(() => replay(file)).toThrow(/no __drizzle_migrations bookkeeping/)
  })
})
