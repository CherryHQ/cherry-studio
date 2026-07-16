// MergeEngine MVP SKIP/INSERT slice — characterization tests for the landed
// pipeline (detached work.sqlite tx + defer_foreign_keys + exhaustive importRows
// switch + offline consistency check). The synthetic backup.sqlite is produced
// by `dbh.sqlite.backup(target)` (online backup → identical schema) and seeded
// via raw SQL. Work (merge base) is the live test DB.
//
// Scope: the engine resolves both top-level members (message.topicId → topic root)
// and nested members (chat_message_file_ref.sourceId → message member, via parent-id
// tracking) — covered by the traverse test below. deferred items (streaming iterate(),
// full consistency checks, identity propagation, junction phase) are tracked via
// TODO(Stage3)/TODO(lite) comments in the implementation.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { MergeContext } from '..'
import { MergeConsistencyCheckError, MergeEngine, MergeStrategyNotImplementedError } from '..'

describe('MergeEngine (MVP SKIP/INSERT slice)', () => {
  // Live test DB = the merge base (work.sqlite). Production migrations + FTS5
  // triggers are applied; beforeEach truncates user tables.
  const dbh = setupTestDatabase()
  // Real 14-domain registry; finalize is pure in-memory and cached.
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let backupPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cs-merge-'))
    backupPath = join(tmpDir, 'backup.sqlite')
    // Clone the (truncated) work schema into a synthetic backup file — same
    // schema, empty user tables, ready to seed.
    await dbh.sqlite.backup(backupPath)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  /**
   * Open the synthetic backup.sqlite and seed raw rows inside one tx. The FK
   * pragma is set BEFORE the tx opens — `PRAGMA foreign_keys` is a documented
   * no-op inside a transaction, so toggling it from the seed callback would not
   * take effect. `foreignKeys: false` plants orphan refs (FK-sabotage cases).
   */
  const seedBackup = (seed: (db: Database.Database) => void, opts: { foreignKeys?: boolean } = {}): void => {
    const db = new Database(backupPath)
    try {
      db.pragma(opts.foreignKeys === false ? 'foreign_keys = OFF' : 'foreign_keys = ON')
      db.transaction(seed)(db)
    } finally {
      db.close()
    }
  }

  /** Insert a topic row (snake_case physical columns). */
  const insertTopic = (db: Database.Database, id: string, name = `topic-${id}`): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO topic (id, name, is_name_manually_edited, order_key, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)`
    ).run(id, name, `order-${id}`, now, now)
  }

  /** Insert a message row. parentId null + role 'root' for the virtual root. */
  const insertMessage = (
    db: Database.Database,
    id: string,
    topicId: string,
    role: 'root' | 'user' | 'assistant' | 'system',
    parentId: string | null,
    modelId: string | null = null
  ): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO message (id, parent_id, topic_id, role, data, searchable_text, status, siblings_group_id, model_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 'success', 0, ?, ?, ?)`
    ).run(id, parentId, topicId, role, JSON.stringify({ parts: [] }), modelId, now, now)
  }

  /** Insert a minimal external file_entry row (origin='external', size NULL). */
  const insertFileEntry = (db: Database.Database, id: string, externalPath = `/tmp/${id}`): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO file_entry (id, origin, name, external_path, created_at, updated_at)
       VALUES (?, 'external', ?, ?, ?, ?)`
    ).run(id, id, externalPath, now, now)
  }

  /** Insert a chat_message_file_ref row (nested TOPICS member via sourceId→message). */
  const insertChatMessageFileRef = (db: Database.Database, id: string, sourceId: string, fileEntryId: string): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO chat_message_file_ref (id, source_id, file_entry_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'attachment', ?, ?)`
    ).run(id, sourceId, fileEntryId, now, now)
  }

  const countRows = (table: string): number =>
    (dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c

  const runMerge = (ctx: MergeContext): Promise<unknown> =>
    new MergeEngine(registry, { backupDbPath: backupPath }).mergeBackupIntoWork(dbh.sqlite, dbh.db, ctx)

  const topCtx = (): MergeContext => ({ domains: ['TOPICS'], skippedFileEntryIds: new Set<string>() })

  it('SKIPs a uuid-entity root that already exists in work (no duplicate, no overwrite)', async () => {
    // Both work and backup hold topic 'tpc-skip' (different names to detect overwrite).
    insertTopic(dbh.sqlite, 'tpc-skip', 'in-work')
    seedBackup((db) => insertTopic(db, 'tpc-skip', 'in-backup'))

    const before = countRows('topic')
    const result = await runMerge(topCtx())

    expect(result).toMatchObject({ degradedToSkips: [] })
    expect(countRows('topic')).toBe(before) // SKIP — no new row
    // Work row untouched (name stays 'in-work', not overwritten by backup).
    const row = dbh.sqlite.prepare(`SELECT name FROM topic WHERE id = 'tpc-skip'`).get() as { name: string }
    expect(row.name).toBe('in-work')
  })

  it('INSERTs a new uuid-entity aggregate (root + include members cascade)', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-new')
      insertMessage(db, 'msg-root', 'tpc-new', 'root', null)
      insertMessage(db, 'msg-child', 'tpc-new', 'assistant', 'msg-root')
    })

    const topicsBefore = countRows('topic')
    const messagesBefore = countRows('message')

    const result = await runMerge(topCtx())

    expect(result).toMatchObject({ degradedToSkips: [] })
    expect(countRows('topic')).toBe(topicsBefore + 1)
    expect(countRows('message')).toBe(messagesBefore + 2) // root + child
    // Both specific rows landed under the new topic.
    const ids = (
      dbh.sqlite.prepare(`SELECT id FROM message WHERE topic_id = 'tpc-new' ORDER BY id`).all() as { id: string }[]
    ).map((r) => r.id)
    expect(ids).toEqual(['msg-child', 'msg-root'])
  })

  it('leaves work.sqlite with empty foreign_key_check and ok integrity_check after merge', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-fk')
      insertMessage(db, 'msg-fk-root', 'tpc-fk', 'root', null)
    })
    await runMerge(topCtx())

    // The engine's in-tx runConsistencyCheck already asserts this; verify externally too.
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
    expect(dbh.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })

  it('is idempotent — re-merging the same backup adds 0 new rows', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-idem')
      insertMessage(db, 'msg-idem', 'tpc-idem', 'root', null)
    })

    await runMerge(topCtx())
    const topicsAfterFirst = countRows('topic')
    const messagesAfterFirst = countRows('message')

    const second = await runMerge(topCtx())

    expect(second).toMatchObject({ degradedToSkips: [] })
    expect(countRows('topic')).toBe(topicsAfterFirst)
    expect(countRows('message')).toBe(messagesAfterFirst)
  })

  it('throws MergeStrategyNotImplementedError for a natural-key domain (scanAggregates guard)', async () => {
    // PROVIDERS aggregates finalize to identityClass 'natural-key'; scanAggregates
    // refuses them until FIELD_MERGE lands. Empty backup is enough — the guard
    // fires before any row read.
    await expect(runMerge({ domains: ['PROVIDERS'], skippedFileEntryIds: new Set<string>() })).rejects.toThrow(
      MergeStrategyNotImplementedError
    )
  })

  it('throws MergeConsistencyCheckError when an inserted row dangles a cross-domain FK', async () => {
    // Backup topic + a root message whose model_id points at a user_model that is
    // NOT in the backup and NOT in work (PROVIDERS is outside this merge). The
    // engine inserts the message; defer_foreign_keys pushes enforcement to
    // COMMIT-time foreign_key_check, which the consistency gate must catch. FK is
    // disabled while seeding so the orphan can be planted in the backup itself.
    seedBackup(
      (db) => {
        insertTopic(db, 'tpc-dangle')
        insertMessage(db, 'msg-dangle', 'tpc-dangle', 'root', null, 'um-nonexistent')
      },
      { foreignKeys: false }
    )

    await expect(runMerge(topCtx())).rejects.toThrow(MergeConsistencyCheckError)
  })

  it('throws MergeStrategyNotImplementedError for an explicit non-SKIP userStrategy (fail-loud)', async () => {
    // The MVP supports only SKIP conflict resolution for uuid-entity; an explicit
    // OVERWRITE/RENAME/FIELD_MERGE override must fail loud rather than silently
    // degrade to skip (which would ignore the user's choice). The guard fires at
    // scan entry, before any row read.
    await expect(
      runMerge({ domains: ['TOPICS'], userStrategy: 'OVERWRITE', skippedFileEntryIds: new Set<string>() })
    ).rejects.toThrow(MergeStrategyNotImplementedError)
  })

  it('skips file_entry roots whose id is in skippedFileEntryIds (honor staging contract)', async () => {
    // Staging supplies skippedFileEntryIds for blobs that were not staged; those file_entry
    // roots MUST be skipped or the merged DB holds rows + refs pointing at missing blobs.
    seedBackup((db) => {
      insertFileEntry(db, 'fe-keep', '/tmp/keep')
      insertFileEntry(db, 'fe-skip', '/tmp/skip')
    })

    const before = countRows('file_entry')
    const result = await runMerge({
      domains: ['FILE_STORAGE'],
      skippedFileEntryIds: new Set(['fe-skip'])
    })

    expect(result).toMatchObject({ degradedToSkips: [] })
    expect(countRows('file_entry')).toBe(before + 1) // only fe-keep lands
    const ids = (dbh.sqlite.prepare(`SELECT id FROM file_entry`).all() as { id: string }[]).map((r) => r.id)
    expect(ids).toContain('fe-keep')
    expect(ids).not.toContain('fe-skip')
  })

  it('fails closed on a non-PK UNIQUE conflict instead of silently dropping the row', async () => {
    // Work has file_entry 'fe-local' with externalPath '/tmp/dup'; backup has a DIFFERENT
    // file_entry (different id, same case-insensitive externalPath). Plain INSERT must
    // throw on the UNIQUE(externalPath) conflict so the tx rolls back — fail-closed,
    // never silently drop + report success.
    insertFileEntry(dbh.sqlite, 'fe-local', '/tmp/dup')
    seedBackup((db) => insertFileEntry(db, 'fe-backup', '/tmp/dup'))

    await expect(runMerge({ domains: ['FILE_STORAGE'], skippedFileEntryIds: new Set<string>() })).rejects.toThrow()
  })

  it('traverses nested include members via their parent member ids (chat_message_file_ref)', async () => {
    // Work already has file_entry 'fe-local' (so the imported file_ref's fileEntryId FK is
    // satisfied). Backup has topic + message + a chat_message_file_ref whose sourceId points
    // at the message. The engine MUST resolve the file_ref via the imported message id
    // (nested member parent), NOT the topic id — else 0 rows return and the file_ref is dropped.
    insertFileEntry(dbh.sqlite, 'fe-local', '/tmp/local')
    seedBackup(
      (db) => {
        insertTopic(db, 'tpc-nest')
        insertMessage(db, 'msg-nest', 'tpc-nest', 'root', null)
        // file_ref.fileEntryId='fe-local' resolves to the WORK-side file_entry (not in
        // backup), so seed with FK off — the cross-DB ref is satisfied post-merge.
        insertChatMessageFileRef(db, 'fr-1', 'msg-nest', 'fe-local')
      },
      { foreignKeys: false }
    )

    const before = countRows('chat_message_file_ref')
    const result = await runMerge(topCtx())

    expect(result).toMatchObject({ degradedToSkips: [] })
    expect(countRows('chat_message_file_ref')).toBe(before + 1) // file_ref traversed via message id
    const row = dbh.sqlite
      .prepare(`SELECT source_id, file_entry_id FROM chat_message_file_ref WHERE id = 'fr-1'`)
      .get() as { source_id: string; file_entry_id: string }
    expect(row.source_id).toBe('msg-nest')
    expect(row.file_entry_id).toBe('fe-local')
  })

  it('honors an explicit SKIP override on a natural-key domain instead of throwing', async () => {
    // PROVIDERS is natural-key (FIELD_MERGE default). Default → throws NotImplemented (MVP
    // can't FIELD_MERGE). An explicit SKIP opts out → every backup row skipped (local
    // survives), no throw. Empty backup is enough — the guard either throws or it doesn't.
    const result = await runMerge({
      domains: ['PROVIDERS'],
      userStrategy: 'SKIP',
      skippedFileEntryIds: new Set<string>()
    })
    expect(result).toMatchObject({ degradedToSkips: [] })
  })
})
