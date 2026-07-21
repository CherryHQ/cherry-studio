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
import { FtsCentralHelper } from '../FtsCentralHelper'

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
    new MergeEngine(registry).mergeBackupIntoWork(dbh.sqlite, dbh.db, ctx)

  const topCtx = (): MergeContext => ({
    backupDbPath: backupPath,
    domains: ['TOPICS'],
    skippedFileEntryIds: new Set<string>()
  })

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

  /** Insert a minimal user_provider row (natural-key providerId PK). */
  const insertProvider = (db: Database.Database, providerId: string, name = `p-${providerId}`): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO user_provider (provider_id, name, api_keys, is_enabled, order_key, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?)`
    ).run(providerId, name, JSON.stringify([{ id: 'k1', key: `key-${providerId}` }]), `order-${providerId}`, now, now)
  }

  /** Insert a minimal user_model row (deterministic PK providerId::modelId). */
  const insertModel = (db: Database.Database, providerId: string, modelId: string): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO user_model (id, provider_id, model_id, name, capabilities, supports_streaming, is_enabled, is_hidden, is_deprecated, order_key, created_at, updated_at)
       VALUES (?, ?, ?, ?, '[]', 1, 1, 0, 0, ?, ?, ?)`
    ).run(`${providerId}::${modelId}`, providerId, modelId, modelId, `order-${modelId}`, now, now)
  }

  it('backfills a natural-key aggregate absent from work (fresh-install restore keeps providers + models)', async () => {
    // Work has no PROVIDERS rows (fresh install). The backup provider + model must be
    // INSERTed keeping their backup PKs — NOT skipped — so a migration restore does not
    // silently drop credentials, and incoming cross-domain FKs (message.modelId etc.)
    // resolve naturally against the deterministic user_model id.
    seedBackup((db) => {
      insertProvider(db, 'openai')
      insertModel(db, 'openai', 'gpt-4o')
    })

    const result = await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>()
    })

    expect(result).toMatchObject({ degradedToSkips: [] }) // backfill is not a degradation
    const provider = dbh.sqlite.prepare(`SELECT api_keys FROM user_provider WHERE provider_id = 'openai'`).get() as {
      api_keys: string
    }
    expect(provider.api_keys).toContain('key-openai') // credentials restored
    const model = dbh.sqlite.prepare(`SELECT id FROM user_model WHERE id = 'openai::gpt-4o'`).get()
    expect(model).toBeDefined() // include member cascaded with the backfilled root
  })

  it('SKIPs a conflicting natural-key aggregate (local wins) and discloses the pending FIELD_MERGE', async () => {
    // Work already has provider 'openai' with a LOCAL key; the backup holds different
    // values. Until FIELD_MERGE lands the local row wins wholesale, and the conflict is
    // recorded in degradedToSkips for UI disclosure (backup field values not merged).
    insertProvider(dbh.sqlite, 'openai', 'local-name')
    seedBackup((db) => insertProvider(db, 'openai', 'backup-name'))

    const result = (await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>()
    })) as { degradedToSkips: { table: string; count: number; reason: string }[] }

    const row = dbh.sqlite.prepare(`SELECT name FROM user_provider WHERE provider_id = 'openai'`).get() as {
      name: string
    }
    expect(row.name).toBe('local-name') // local wins
    expect(result.degradedToSkips).toEqual([
      { table: 'user_provider', count: 1, reason: expect.stringContaining('FIELD_MERGE not implemented') }
    ])
  })

  it('repairs a dangling nullable FK by SET NULL (disclosed) instead of aborting the restore', async () => {
    // Backup topic + a root message whose model_id points at a user_model that is
    // NOT in the backup and NOT in work (PROVIDERS is outside this merge). message.model_id
    // is nullable (onDelete set null posture) — the repair pass clears it so the restore
    // completes, and the degradation is disclosed. FK is disabled while seeding so the
    // orphan can be planted in the backup itself.
    seedBackup(
      (db) => {
        insertTopic(db, 'tpc-dangle')
        insertMessage(db, 'msg-dangle', 'tpc-dangle', 'root', null, 'um-nonexistent')
      },
      { foreignKeys: false }
    )

    const result = (await runMerge(topCtx())) as { degradedToSkips: { table: string; reason: string }[] }

    const row = dbh.sqlite.prepare(`SELECT model_id FROM message WHERE id = 'msg-dangle'`).get() as {
      model_id: string | null
    }
    expect(row.model_id).toBeNull() // link dropped, row survives
    expect(result.degradedToSkips).toEqual([
      { table: 'message', count: 1, reason: expect.stringContaining('SET NULL') }
    ])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([]) // repair left the graph clean
  })

  it('repairs a dangling NOT NULL FK by pruning the row (disclosed) instead of aborting the restore', async () => {
    // chat_message_file_ref.file_entry_id is NOT NULL — a ref whose file_entry exists in
    // neither backup nor work cannot be nulled; the repair pass prunes the row so the
    // restore completes, and the prune is disclosed.
    seedBackup(
      (db) => {
        insertTopic(db, 'tpc-prune')
        insertMessage(db, 'msg-prune', 'tpc-prune', 'root', null)
        insertChatMessageFileRef(db, 'fr-dangle', 'msg-prune', 'fe-nonexistent')
      },
      { foreignKeys: false }
    )

    const result = (await runMerge(topCtx())) as { degradedToSkips: { table: string; reason: string }[] }

    expect(dbh.sqlite.prepare(`SELECT id FROM chat_message_file_ref WHERE id = 'fr-dangle'`).get()).toBeUndefined()
    // The message itself survives — only the required-target row was pruned.
    expect(dbh.sqlite.prepare(`SELECT id FROM message WHERE id = 'msg-prune'`).get()).toBeDefined()
    expect(result.degradedToSkips).toEqual([
      { table: 'chat_message_file_ref', count: 1, reason: expect.stringContaining('pruned') }
    ])
    expect(dbh.sqlite.pragma('foreign_key_check')).toEqual([])
  })

  it('refuses to merge into a base snapshot that is already FK-dirty (repair-pass safety contract)', async () => {
    // Plant a pre-existing violation in WORK (not the backup): the repair pass must never
    // run against a dirty base — it could no longer distinguish local rows from imported ones.
    dbh.sqlite.pragma('foreign_keys = OFF')
    insertTopic(dbh.sqlite, 'tpc-dirty')
    insertMessage(dbh.sqlite, 'msg-dirty', 'tpc-dirty', 'root', null, 'um-preexisting-orphan')
    dbh.sqlite.pragma('foreign_keys = ON')
    seedBackup((db) => insertTopic(db, 'tpc-any'))

    await expect(runMerge(topCtx())).rejects.toThrow(MergeConsistencyCheckError)
    // And nothing was repaired/deleted in the base.
    expect(dbh.sqlite.prepare(`SELECT model_id FROM message WHERE id = 'msg-dirty'`).get()).toMatchObject({
      model_id: 'um-preexisting-orphan'
    })
  })

  it('throws MergeStrategyNotImplementedError for an explicit non-SKIP userStrategy (fail-loud)', async () => {
    // The MVP supports only SKIP conflict resolution for uuid-entity; an explicit
    // OVERWRITE/RENAME/FIELD_MERGE override must fail loud rather than silently
    // degrade to skip (which would ignore the user's choice). The guard fires at
    // scan entry, before any row read.
    await expect(
      runMerge({
        backupDbPath: backupPath,
        domains: ['TOPICS'],
        userStrategy: 'OVERWRITE',
        skippedFileEntryIds: new Set<string>()
      })
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
      backupDbPath: backupPath,
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

    await expect(
      runMerge({ backupDbPath: backupPath, domains: ['FILE_STORAGE'], skippedFileEntryIds: new Set<string>() })
    ).rejects.toThrow()
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
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      userStrategy: 'SKIP',
      skippedFileEntryIds: new Set<string>()
    })
    expect(result).toMatchObject({ degradedToSkips: [] })
  })

  it('preserves the app_state key-set across the merge tx (no add/drop)', async () => {
    // app_state is ALWAYS_STRIP (backup holds none); the merge tx must not touch its key-set.
    // PREFERENCES may UPDATE values (forward-compat), but the key-set is invariant — a
    // canary key surviving merge proves the engine doesn't write app_state out of contract.
    const now = Date.now()
    dbh.sqlite
      .prepare(`INSERT INTO app_state (key, value, created_at, updated_at) VALUES (?, '{}', ?, ?)`)
      .run('migration_v2_status', now, now)
    dbh.sqlite
      .prepare(`INSERT INTO app_state (key, value, created_at, updated_at) VALUES (?, '{}', ?, ?)`)
      .run('renderer.theme', now, now)
    const keysBefore = new Set(
      (dbh.sqlite.prepare(`SELECT key FROM app_state`).all() as { key: string }[]).map((r) => r.key)
    )

    seedBackup((db) => insertTopic(db, 'tpc-appstate'))
    await runMerge(topCtx())

    const keysAfter = new Set(
      (dbh.sqlite.prepare(`SELECT key FROM app_state`).all() as { key: string }[]).map((r) => r.key)
    )
    expect(keysAfter).toEqual(keysBefore)
  })

  it('rebuilds message_fts in-tx so the FTS index stays consistent with imported content', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-fts')
      insertMessage(db, 'msg-fts', 'tpc-fts', 'root', null)
    })

    await runMerge(topCtx())

    // The pipeline ran FtsCentralHelper.rebuild → integrityCheck in-tx (no throw during merge
    // = the index was consistent at COMMIT). Re-check externally to confirm it still matches
    // the imported content after the connection re-enters autocommit.
    expect(() => FtsCentralHelper.integrityCheck(dbh.sqlite)).not.toThrow()
  })
})
