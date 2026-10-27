import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'

import { applyMigrations } from '@data/db/applyMigrations'
import { registerKnowledgeFunctions } from '@data/db/knowledgeFunctions'

type Journal = { entries: Array<{ tag: string }> } & Record<string, unknown>

const MIGRATIONS = resolve('migrations/sqlite-drizzle')

// Builds a chain that stops before `stopTag`, i.e. a database as an earlier release left it.
function chainBefore(root: string, stopTag: string): string {
  const folder = join(root, `before-${stopTag}`)
  mkdirSync(join(folder, 'meta'), { recursive: true })
  const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta/_journal.json'), 'utf8')) as Journal
  const stop = journal.entries.findIndex((entry) => entry.tag.startsWith(stopTag))
  expect(stop).toBeGreaterThan(0)
  const kept = journal.entries.slice(0, stop)
  for (const entry of kept) cpSync(join(MIGRATIONS, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`))
  writeFileSync(join(folder, 'meta/_journal.json'), JSON.stringify({ ...journal, entries: kept }))
  return folder
}

describe('per-model api key routing migration: upgrade from main', () => {
  let root: string | null = null
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true })
    root = null
  })

  // 0028 is main's knowledge_item rebuild; 0029 is this PR's column. Cover both starting points:
  // a database from before main's 0028, and one already at main's current head (0028 applied).
  it.each(['0028', '0029'])(
    'upgrades a populated database stopped before %s, keeping rows and adding a null api_key_id',
    (stopTag) => {
      root = mkdtempSync(join(tmpdir(), 'cs-api-key-migration-'))
      const sqlite = new Database(join(root, 'old.db'))
      registerKnowledgeFunctions(sqlite)
      sqlite.pragma('foreign_keys = ON')
      const db = drizzle({ client: sqlite, casing: 'snake_case' })

      applyMigrations(db, chainBefore(root, stopTag))
      const modelColumnsBefore = (sqlite.pragma('table_info(user_model)') as Array<{ name: string }>).map((c) => c.name)
      expect(modelColumnsBefore).not.toContain('api_key_id')

      sqlite
        .prepare(
          "INSERT INTO user_provider (provider_id, name, order_key, created_at, updated_at) VALUES ('p1', 'Provider', 'a0', 1, 1)"
        )
        .run()
      sqlite
        .prepare(
          "INSERT INTO user_model (id, provider_id, model_id, preset_model_id, order_key, created_at, updated_at) VALUES ('p1::m1', 'p1', 'm1', 'm1', 'a0', 1, 1)"
        )
        .run()
      sqlite
        .prepare(
          "INSERT INTO knowledge_base (id, name, order_key, status, chunk_size, chunk_overlap, created_at, updated_at) VALUES ('kb1', 'KB', 'a0', 'completed', 1024, 200, 1, 1)"
        )
        .run()
      sqlite
        .prepare(
          "INSERT INTO knowledge_item (id, base_id, type, data, status, created_at, updated_at) VALUES ('dir1', 'kb1', 'directory', '{\"source\":\"/docs\"}', 'completed', 1, 1)"
        )
        .run()
      sqlite
        .prepare(
          "INSERT INTO knowledge_item (id, base_id, group_id, type, data, status, created_at, updated_at) VALUES ('f1', 'kb1', 'dir1', 'file', '{\"source\":\"/docs/a.pdf\"}', 'completed', 1, 1)"
        )
        .run()
      const items = () =>
        sqlite.prepare('SELECT id, base_id, group_id, type, data, status FROM knowledge_item ORDER BY id').all()
      const itemsBefore = items()
      const modelBefore = sqlite.prepare('SELECT * FROM user_model WHERE id = ?').get('p1::m1') as Record<
        string,
        unknown
      >

      applyMigrations(db, MIGRATIONS)

      expect(items()).toEqual(itemsBefore)
      expect(sqlite.pragma('foreign_key_check')).toEqual([])
      const modelAfter = sqlite.prepare('SELECT * FROM user_model WHERE id = ?').get('p1::m1') as Record<
        string,
        unknown
      >
      expect(modelAfter).toEqual({ ...modelBefore, api_key_id: null })
      expect(sqlite.prepare('SELECT count(*) AS n FROM user_provider').get()).toEqual({ n: 1 })
      // main's 0028 rebuild ran: file items may now be `preparing`.
      sqlite
        .prepare(
          "INSERT INTO knowledge_item (id, base_id, type, data, status, created_at, updated_at) VALUES ('f2', 'kb1', 'file', '{\"source\":\"/x\"}', 'preparing', 1, 1)"
        )
        .run()
      sqlite.close()
    }
  )
})
