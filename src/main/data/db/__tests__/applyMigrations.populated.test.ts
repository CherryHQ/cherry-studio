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
 * Does *this branch's* `cleanup_policy` migration preserve real data?
 *
 * `applyMigrations.test.ts` covers the runner: that it disables foreign keys
 * where the pragma applies, proven against a synthetic recreate (#17569). This
 * file covers the migration itself, against the real released baseline and real
 * `file_entry` rows — a different question, and the one that matters on upgrade.
 *
 * Worth its own file because the recreate has several independent ways to lose
 * data that a correct runner does not prevent: a column dropped from the
 * `INSERT … SELECT` list silently nulls it for every existing row, a CHECK or a
 * functional index can fail to survive the rename, and pre-existing rows could
 * land on the wrong `cleanup_policy` default. None of it is observable when
 * migrating an empty database, which is all the suite did before.
 */

/**
 * Build a migrations folder containing every entry before one target
 * migration, so a test can stop at that baseline and migrate forward across it.
 * Drizzle drives ordering from `meta/_journal.json`, so trimming that (and
 * copying the matching `.sql` files) is enough — no snapshot needed at runtime.
 *
 * The default target is the tip for a branch-local migration that may be
 * regenerated after a merge. Tests for an older shipped migration name it
 * explicitly; otherwise adding a later migration would silently stop testing
 * the populated migrate-forward path that file exists to prove.
 */
function baselineMigrationsFolder(into: string, beforeTag?: string): string {
  const source = resolveMigrationsPath()
  const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>
  }

  const targetIndex = beforeTag
    ? journal.entries.findIndex((entry) => entry.tag === beforeTag)
    : journal.entries.length - 1
  if (targetIndex < 0) throw new Error(`Migration not found: ${beforeTag}`)

  const kept = journal.entries.slice(0, targetIndex)
  mkdirSync(join(into, 'meta'), { recursive: true })
  writeFileSync(join(into, 'meta', '_journal.json'), JSON.stringify({ ...journal, entries: kept }))
  for (const entry of kept) {
    copyFileSync(join(source, `${entry.tag}.sql`), join(into, `${entry.tag}.sql`))
  }
  return into
}

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
    applyMigrations(db, baselineMigrationsFolder(join(tempDir, 'baseline'), '0004_fresh_roland_deschain'))
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
    applyMigrations(db, baselineMigrationsFolder(join(tempDir, 'baseline'), '0004_fresh_roland_deschain'))
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

  it('backfills durable refs for existing agent-session attachments', () => {
    applyMigrations(db, baselineMigrationsFolder(join(tempDir, 'baseline')))
    const now = Date.now()
    const fileEntryId = '77777777-7777-7777-8777-777777777777'
    const messageId = '88888888-8888-4888-8888-888888888888'

    sqlite
      .prepare(
        `INSERT INTO file_entry
          (id, origin, name, ext, size, external_path, cleanup_policy, created_at, updated_at, deleted_at)
         VALUES (?, 'internal', 'report', 'pdf', 12, NULL, 'delete_when_unreferenced', ?, ?, NULL)`
      )
      .run(fileEntryId, now, now)
    sqlite
      .prepare(
        `INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
         VALUES ('workspace-attachment-migrate', 'Workspace', '/tmp/attachment-migrate', 'user', 'a0', ?, ?)`
      )
      .run(now, now)
    sqlite
      .prepare(
        `INSERT INTO agent_session (id, name, workspace_id, order_key, created_at, updated_at)
         VALUES ('session-attachment-migrate', 'Session', 'workspace-attachment-migrate', 'a0', ?, ?)`
      )
      .run(now, now)

    const filePart = {
      type: 'file',
      url: 'file:///old/location/report.pdf',
      mediaType: 'application/pdf',
      filename: 'report.pdf',
      providerMetadata: { cherry: { fileEntryId } }
    }
    const missingPart = {
      ...filePart,
      filename: 'missing.pdf',
      providerMetadata: { cherry: { fileEntryId: '99999999-9999-7999-8999-999999999999' } }
    }
    sqlite
      .prepare(
        `INSERT INTO agent_session_message
          (id, session_id, role, data, searchable_text, status, created_at, updated_at)
         VALUES (?, 'session-attachment-migrate', 'user', ?, '', 'success', ?, ?)`
      )
      .run(messageId, JSON.stringify({ parts: [filePart, filePart, missingPart] }), now, now)

    applyMigrations(db, resolveMigrationsPath())

    const refs = sqlite
      .prepare(
        `SELECT id, file_entry_id, source_id, role
         FROM agent_session_message_file_ref
         ORDER BY file_entry_id`
      )
      .all() as Array<{ id: string; file_entry_id: string; source_id: string; role: string }>
    expect(refs).toHaveLength(1)
    expect(refs[0]).toMatchObject({ file_entry_id: fileEntryId, source_id: messageId, role: 'attachment' })
    expect(refs[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('moves legacy sticky session pointers into the constrained relation', () => {
    applyMigrations(db, baselineMigrationsFolder(join(tempDir, 'baseline'), '0005_slow_obadiah_stane'))
    const now = Date.now()
    sqlite
      .prepare(
        `INSERT INTO agent (id, type, name, instructions, order_key, created_at, updated_at)
         VALUES ('agent-task-migrate', 'claude-code', 'Agent', '', 'a0', ?, ?)`
      )
      .run(now, now)
    sqlite
      .prepare(
        `INSERT INTO agent_workspace (id, name, path, type, order_key, created_at, updated_at)
         VALUES ('workspace-task-migrate', 'Workspace', '/tmp/task-migrate', 'user', 'a0', ?, ?)`
      )
      .run(now, now)
    sqlite
      .prepare(
        `INSERT INTO agent_session (id, agent_id, name, workspace_id, order_key, created_at, updated_at)
         VALUES ('session-task-migrate', 'agent-task-migrate', 'Session', 'workspace-task-migrate', 'a0', ?, ?)`
      )
      .run(now, now)

    const legacyReuse = JSON.stringify({ reuse: { enabled: true, sessionId: 'session-task-migrate', revision: 3 } })
    const template = JSON.stringify({ agentId: 'agent-task-migrate', prompt: 'test', timeoutMinutes: 0 })
    const trigger = JSON.stringify({ kind: 'interval', ms: 60_000 })
    const catchUpPolicy = JSON.stringify({ kind: 'skip-missed' })
    for (const [id, name, updatedAt] of [
      ['schedule-old', 'old', now],
      ['schedule-new', 'new', now + 1]
    ]) {
      sqlite
        .prepare(
          `INSERT INTO job_schedule
            (id, type, name, trigger, job_input_template, enabled, catch_up_policy, metadata, created_at, updated_at)
           VALUES (?, 'agent.task', ?, ?, ?, 0, ?, ?, ?, ?)`
        )
        .run(id, name, trigger, template, catchUpPolicy, legacyReuse, now, updatedAt)
    }

    // JSON columns predate shape validation and can contain hand-edited or
    // damaged text. One corrupt schedule must not brick the whole upgrade.
    sqlite
      .prepare(
        `INSERT INTO job_schedule
          (id, type, name, trigger, job_input_template, enabled, catch_up_policy, metadata, created_at, updated_at)
         VALUES ('schedule-bad-template', 'agent.task', 'bad-template', ?, '{broken', 0, ?, ?, ?, ?)`
      )
      .run(trigger, catchUpPolicy, legacyReuse, now, now + 2)
    sqlite
      .prepare(
        `INSERT INTO job_schedule
          (id, type, name, trigger, job_input_template, enabled, catch_up_policy, metadata, created_at, updated_at)
         VALUES ('schedule-bad-metadata', 'agent.task', 'bad-metadata', ?, ?, 0, ?, '{broken', ?, ?)`
      )
      .run(trigger, template, catchUpPolicy, now, now + 3)

    applyMigrations(db, resolveMigrationsPath())

    expect(
      sqlite.prepare(`SELECT task_schedule_id FROM agent_session WHERE id = 'session-task-migrate'`).get()
    ).toEqual({
      task_schedule_id: 'schedule-new'
    })
    const metadata = sqlite
      .prepare(`SELECT id, metadata FROM job_schedule WHERE id IN ('schedule-old', 'schedule-new') ORDER BY id`)
      .all() as Array<{ id: string; metadata: string }>
    expect(metadata.map((row) => JSON.parse(row.metadata))).toEqual([
      { reuse: { enabled: true, revision: 3 } },
      { reuse: { enabled: true, revision: 3 } }
    ])

    // One session cannot serve two schedules after migration, and schedule
    // deletion clears the internal pointer rather than retaining stale state.
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO agent_session (id, agent_id, name, workspace_id, task_schedule_id, order_key, created_at, updated_at)
           VALUES ('session-duplicate-binding', 'agent-task-migrate', 'Duplicate', 'workspace-task-migrate', 'schedule-new', 'a1', ?, ?)`
        )
        .run(now, now)
    ).toThrow(/UNIQUE|constraint/i)
    sqlite.prepare(`DELETE FROM job_schedule WHERE id = 'schedule-new'`).run()
    expect(
      sqlite.prepare(`SELECT task_schedule_id FROM agent_session WHERE id = 'session-task-migrate'`).get()
    ).toEqual({
      task_schedule_id: null
    })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })
})
