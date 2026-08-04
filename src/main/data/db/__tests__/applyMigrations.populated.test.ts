import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { applyMigrations } from '@data/db/applyMigrations'
import type { DbType } from '@data/db/types'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Do appended migrations preserve and repair real populated data?
 *
 * `applyMigrations.test.ts` covers the runner: that it disables foreign keys
 * where the pragma applies, proven against a synthetic recreate (#17569). This
 * file covers the migrations themselves against the real released baseline — a
 * different question, and the one that matters on upgrade.
 *
 * Worth its own file because the recreate has several independent ways to lose
 * data that a correct runner does not prevent: a column dropped from the
 * `INSERT … SELECT` list silently nulls it for every existing row, a CHECK or a
 * functional index can fail to survive the rename, and pre-existing rows could
 * land on the wrong `cleanup_policy` default. None of it is observable when
 * migrating an empty database, which is all the suite did before.
 */

/**
 * Build a migrations folder containing every entry before a named migration,
 * so a test can stop at that baseline and migrate forward across it.
 * Drizzle drives ordering from `meta/_journal.json`, so trimming that (and
 * copying the matching `.sql` files) is enough — no snapshot needed at runtime.
 */
function baselineMigrationsFolder(into: string, beforeTag: string): string {
  const source = resolveMigrationsPath()
  const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>
  }

  const targetIndex = journal.entries.findIndex((entry) => entry.tag === beforeTag)
  if (targetIndex < 0) {
    throw new Error(`Migration not found: ${beforeTag}`)
  }

  const kept = journal.entries.slice(0, targetIndex)
  mkdirSync(join(into, 'meta'), { recursive: true })
  writeFileSync(join(into, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: kept }))
  for (const entry of kept) {
    copyFileSync(join(source, `${entry.tag}.sql`), join(into, `${entry.tag}.sql`))
  }
  return into
}

const CLEANUP_POLICY_MIGRATION = '0003_slow_proudstar'
const MESSAGE_CYCLE_REPAIR_MIGRATION = '0005_repair_message_parent_cycles'

describe('applyMigrations over a populated database', () => {
  let tempDir: string
  let sqlite: Database.Database
  let db: DbType

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cs-migrate-populated-'))
    sqlite = new Database(join(tempDir, 'test.db'))
    db = drizzle({ client: sqlite, casing: 'snake_case' })
  })

  afterEach(() => {
    sqlite.close()
    rmSync(tempDir, { recursive: true, force: true })
  })

  /** Seed rows that exercise both `file_entry` variants plus a child reference. */
  function seedBaselineRows(): void {
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO file_entry (id, origin, name, ext, size, external_path, created_at, updated_at, deleted_at)
         VALUES (?, 'internal', 'kept', 'png', 12, NULL, ?, ?, NULL)`
      )
      .run('11111111-1111-7111-8111-111111111111', now, now)
    sqlite
      .prepare(
        `INSERT INTO file_entry (id, origin, name, ext, size, external_path, created_at, updated_at, deleted_at)
         VALUES (?, 'external', 'linked', 'pdf', NULL, ?, ?, ?, NULL)`
      )
      .run('22222222-2222-7222-8222-222222222222', '/Users/me/linked.pdf', now, now)
    // A trashed internal row: `deleted_at` must survive the recreate too, or a
    // trashed file would silently reappear in the library after upgrading.
    sqlite
      .prepare(
        `INSERT INTO file_entry (id, origin, name, ext, size, external_path, created_at, updated_at, deleted_at)
         VALUES (?, 'internal', 'trashed', 'txt', 3, NULL, ?, ?, ?)`
      )
      .run('33333333-3333-7333-8333-333333333333', now, now, now)

    sqlite
      .prepare(
        `INSERT INTO user_provider (provider_id, name, order_key, created_at, updated_at)
         VALUES ('openai', 'OpenAI', 'a0', ?, ?)`
      )
      .run(now, now)
    sqlite
      .prepare(
        `INSERT INTO provider_logo_file_ref (id, file_entry_id, source_id, created_at, updated_at)
         VALUES (?, ?, 'openai', ?, ?)`
      )
      .run('44444444-4444-7444-8444-444444444444', '11111111-1111-7111-8111-111111111111', now, now)
  }

  it('preserves every file_entry row and its references across the cleanup_policy recreate', () => {
    applyMigrations(db, baselineMigrationsFolder(join(tempDir, 'baseline'), CLEANUP_POLICY_MIGRATION))
    seedBaselineRows()

    applyMigrations(db, resolveMigrationsPath())

    const rows = sqlite
      .prepare(
        `SELECT id, origin, name, ext, size, external_path, deleted_at, cleanup_policy FROM file_entry ORDER BY id`
      )
      .all() as Array<Record<string, unknown>>

    expect(rows.map((row) => row.id)).toEqual([
      '11111111-1111-7111-8111-111111111111',
      '22222222-2222-7222-8222-222222222222',
      '33333333-3333-7333-8333-333333333333'
    ])
    // Every column the recreate copied must round-trip — a column dropped from the
    // INSERT … SELECT list silently nulls it for every existing row.
    expect(rows[0]).toMatchObject({ origin: 'internal', name: 'kept', ext: 'png', size: 12, external_path: null })
    expect(rows[1]).toMatchObject({ origin: 'external', external_path: '/Users/me/linked.pdf', size: null })
    expect(rows[2]).toMatchObject({ name: 'trashed', deleted_at: expect.any(Number) })

    // Pre-existing rows predate the intent column, so they must land on the
    // conservative default: kept at zero refs, never auto-reclaimed. The opposite
    // default would hand a user's whole library to the cleanup pass on first boot.
    expect(rows.map((row) => row.cleanup_policy)).toEqual(['manual', 'manual', 'manual'])

    // The child row must still resolve. This is where the runner fix (#17569)
    // shows up on real data: before it, `DROP TABLE file_entry` cascaded every
    // ref away silently, and for this branch that meant every file then looked
    // unreferenced to the cleanup pass.
    const logoRefs = sqlite.prepare(`SELECT file_entry_id, source_id FROM provider_logo_file_ref`).all()
    expect(logoRefs).toEqual([{ file_entry_id: '11111111-1111-7111-8111-111111111111', source_id: 'openai' }])
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
    expect(String(sqlite.pragma('integrity_check', { simple: true }))).toBe('ok')
  })

  it('keeps the recreated table enforcing its constraints on new writes', () => {
    applyMigrations(db, baselineMigrationsFolder(join(tempDir, 'baseline'), CLEANUP_POLICY_MIGRATION))
    seedBaselineRows()
    applyMigrations(db, resolveMigrationsPath())

    const now = Date.now()
    // The rebuilt table must carry the CHECKs forward, not just the columns.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO file_entry (id, origin, name, ext, size, external_path, cleanup_policy, created_at, updated_at, deleted_at)
           VALUES (?, 'internal', 'bad', 'png', 1, NULL, 'bogus', ?, ?, NULL)`
        )
        .run('55555555-5555-7555-8555-555555555555', now, now)
    ).toThrow(/CHECK|constraint/i)

    // And the functional UNIQUE on lower(external_path) must survive the rename,
    // or two case-variant external entries could both be inserted.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO file_entry (id, origin, name, ext, size, external_path, cleanup_policy, created_at, updated_at, deleted_at)
           VALUES (?, 'external', 'dupe', 'pdf', NULL, ?, 'manual', ?, ?, NULL)`
        )
        .run('66666666-6666-7666-8666-666666666666', '/Users/me/LINKED.pdf', now, now)
    ).toThrow(/UNIQUE|constraint/i)
  })

  it('repairs migrated user-assistant parent cycles without dropping either response', () => {
    applyMigrations(db, baselineMigrationsFolder(join(tempDir, 'baseline'), MESSAGE_CYCLE_REPAIR_MIGRATION))

    sqlite.exec(`
      INSERT INTO topic (id, name, order_key, created_at, updated_at)
      VALUES ('topic-cycle', 'Cycle', 'a0', 1, 1);

      INSERT INTO message (id, parent_id, topic_id, role, data, status, created_at, updated_at)
      VALUES
        ('root', NULL, 'topic-cycle', 'root', '{"parts":[]}', 'success', 1, 1),
        ('previous', 'root', 'topic-cycle', 'assistant', '{"parts":[]}', 'success', 10, 10),
        ('user', 'cycled-response', 'topic-cycle', 'user', '{"parts":[]}', 'success', 30, 30),
        ('cycled-response', 'user', 'topic-cycle', 'assistant', '{"parts":[]}', 'success', 40, 40),
        ('sibling-response', 'user', 'topic-cycle', 'assistant', '{"parts":[]}', 'success', 50, 50);
    `)

    applyMigrations(db, resolveMigrationsPath())

    const parents = sqlite.prepare('SELECT id, parent_id FROM message ORDER BY created_at').all()
    expect(parents).toEqual([
      { id: 'root', parent_id: null },
      { id: 'previous', parent_id: 'root' },
      { id: 'user', parent_id: 'previous' },
      { id: 'cycled-response', parent_id: 'user' },
      { id: 'sibling-response', parent_id: 'user' }
    ])

    const { count: unreachableCount } = sqlite
      .prepare(
        `WITH RECURSIVE reachable(id) AS (
           SELECT id FROM message WHERE parent_id IS NULL
           UNION
           SELECT child.id FROM message child
           INNER JOIN reachable parent ON child.parent_id = parent.id
         )
         SELECT count(*) AS count
         FROM message
         LEFT JOIN reachable ON reachable.id = message.id
         WHERE reachable.id IS NULL`
      )
      .get() as { count: number }
    expect(unreachableCount).toBe(0)
  })
})
