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

import { assertFtsIntegrity } from '../ftsCentral'
import { MergeConsistencyCheckError, MergeEngine, MergeStrategyNotImplementedError } from '../MergeEngine'
import type { MergeContext } from '../types'

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
    skippedFileEntryIds: new Set<string>(),
    stagedFileEntryIds: new Set<string>()
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
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    expect(result).toMatchObject({ degradedToSkips: [] }) // backfill is not a degradation
    const provider = dbh.sqlite.prepare(`SELECT api_keys FROM user_provider WHERE provider_id = 'openai'`).get() as {
      api_keys: string
    }
    expect(provider.api_keys).toContain('key-openai') // credentials restored
    const model = dbh.sqlite.prepare(`SELECT id FROM user_model WHERE id = 'openai::gpt-4o'`).get()
    expect(model).toBeDefined() // include member cascaded with the backfilled root
  })

  it('FIELD_MERGEs a conflicting natural-key aggregate (keeps local non-null, fills from backup)', async () => {
    // Work has provider 'openai' with a LOCAL name; backup has a different name.
    // FIELD_MERGE keeps local name (non-null) and does not disclose "not implemented".
    insertProvider(dbh.sqlite, 'openai', 'local-name')
    seedBackup((db) => {
      insertProvider(db, 'openai', 'backup-name')
      insertModel(db, 'openai', 'gpt-4o')
    })

    const result = (await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })) as { degradedToSkips: { table: string; count: number; reason: string }[] }

    const row = dbh.sqlite.prepare(`SELECT name FROM user_provider WHERE provider_id = 'openai'`).get() as {
      name: string
    }
    expect(row.name).toBe('local-name') // local non-null wins
    expect(dbh.sqlite.prepare(`SELECT id FROM user_model WHERE id = 'openai::gpt-4o'`).get()).toBeDefined()
    expect(result.degradedToSkips.filter((d) => d.reason.includes('FIELD_MERGE not implemented'))).toEqual([])
  })

  it('remote-fills-local-empty: backup apiKeys fill a seeded empty [] local provider', async () => {
    const now = Date.now()
    dbh.sqlite
      .prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`
      )
      .run('openai', 'OpenAI', '[]', 'o-local', now, now)
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?, ?)`
      ).run('openai', 'OpenAI', JSON.stringify([{ id: 'k1', key: 'from-backup' }]), 'o-backup', now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    const row = dbh.sqlite.prepare(`SELECT api_keys FROM user_provider WHERE provider_id = 'openai'`).get() as {
      api_keys: string
    }
    expect(row.api_keys).toContain('from-backup')
  })

  it('local-priority tags: local empty fills from backup; non-empty local wins', async () => {
    const now = Date.now()
    const insertSkill = (
      db: Database.Database,
      id: string,
      folder: string,
      tags: string,
      name: string
    ): void => {
      db.prepare(
        `INSERT INTO agent_global_skill (id, name, folder_name, source, tags, content_hash, is_enabled, created_at, updated_at)
         VALUES (?, ?, ?, 'builtin', ?, ?, 0, ?, ?)`
      ).run(id, name, folder, tags, `h-${id}`, now, now)
    }

    // Case A: local=[] (NOT NULL DEFAULT) + backup=[tags] → backup fills
    insertSkill(dbh.sqlite, 'skill-empty', 'f-empty', '[]', 'empty-local')
    seedBackup((db) => {
      insertSkill(db, 'skill-empty', 'f-empty', JSON.stringify(['from-backup']), 'empty-backup')
    })
    await runMerge({
      backupDbPath: backupPath,
      domains: ['SKILLS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })
    const filled = dbh.sqlite.prepare(`SELECT tags FROM agent_global_skill WHERE folder_name = 'f-empty'`).get() as {
      tags: string
    }
    expect(JSON.parse(filled.tags)).toEqual(['from-backup'])

    // Case B: local=[a] + backup=[b] → local wins
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = await mkdtemp(join(tmpdir(), 'cs-merge-'))
    backupPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupPath)
    dbh.sqlite.prepare(`DELETE FROM agent_global_skill`).run()

    insertSkill(dbh.sqlite, 'skill-keep', 'f-keep', JSON.stringify(['local-tag']), 'keep-local')
    seedBackup((db) => {
      insertSkill(db, 'skill-keep', 'f-keep', JSON.stringify(['backup-tag']), 'keep-backup')
    })
    await runMerge({
      backupDbPath: backupPath,
      domains: ['SKILLS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })
    const kept = dbh.sqlite.prepare(`SELECT tags FROM agent_global_skill WHERE folder_name = 'f-keep'`).get() as {
      tags: string
    }
    expect(JSON.parse(kept.tags)).toEqual(['local-tag'])

    // Case C: local='' (empty string — also empty under isEmptyForRemoteFill; tags is NOT NULL
    // so SQL NULL is unrepresentable) + backup=[tags] → backup fills
    await rm(tmpDir, { recursive: true, force: true })
    tmpDir = await mkdtemp(join(tmpdir(), 'cs-merge-'))
    backupPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupPath)
    dbh.sqlite.prepare(`DELETE FROM agent_global_skill`).run()

    insertSkill(dbh.sqlite, 'skill-blank', 'f-blank', '', 'blank-local')
    seedBackup((db) => {
      insertSkill(db, 'skill-blank', 'f-blank', JSON.stringify(['from-backup-blank']), 'blank-backup')
    })
    await runMerge({
      backupDbPath: backupPath,
      domains: ['SKILLS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })
    const fromBlank = dbh.sqlite
      .prepare(`SELECT tags FROM agent_global_skill WHERE folder_name = 'f-blank'`)
      .get() as { tags: string }
    expect(JSON.parse(fromBlank.tags)).toEqual(['from-backup-blank'])
  })

  it('deep-merge authConfig: seeder skeleton keeps type, backup fills empty credential fields', async () => {
    // M1 regression: seeded {type:'iam-gcp',project:'',location:''} is NOT empty under
    // remote-fills-local-empty (type is non-empty). deep-merge must fill project/location.
    const now = Date.now()
    const skeleton = JSON.stringify({ type: 'iam-gcp', project: '', location: '' })
    const backed = JSON.stringify({ type: 'iam-gcp', project: 'my-proj', location: 'us-central1' })
    dbh.sqlite
      .prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      )
      .run('vertexai', 'Vertex AI', skeleton, 'o-local', now, now)
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      ).run('vertexai', 'Vertex AI', backed, 'o-backup', now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    const row = dbh.sqlite.prepare(`SELECT auth_config FROM user_provider WHERE provider_id = 'vertexai'`).get() as {
      auth_config: string
    }
    const auth = JSON.parse(row.auth_config) as { type: string; project: string; location: string }
    expect(auth.type).toBe('iam-gcp')
    expect(auth.project).toBe('my-proj')
    expect(auth.location).toBe('us-central1')
  })

  it('deep-merge authConfig: type-mismatched seeder skeleton takes backup whole-cell (no hybrid)', async () => {
    // Discriminator conflict: local iam-aws skeleton + backup api-key-aws must NOT become
    // {type:'iam-aws', region:'us-west-2'} hybrid — take backup type + credentials.
    const now = Date.now()
    const skeleton = JSON.stringify({ type: 'iam-aws', region: '' })
    const backed = JSON.stringify({ type: 'api-key-aws', region: 'us-west-2' })
    dbh.sqlite
      .prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      )
      .run('aws-bedrock', 'AWS Bedrock', skeleton, 'o-local', now, now)
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      ).run('aws-bedrock', 'AWS Bedrock', backed, 'o-backup', now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    const row = dbh.sqlite.prepare(`SELECT auth_config FROM user_provider WHERE provider_id = 'aws-bedrock'`).get() as {
      auth_config: string
    }
    const auth = JSON.parse(row.auth_config) as { type: string; region: string }
    expect(auth.type).toBe('api-key-aws')
    expect(auth.region).toBe('us-west-2')
  })

  it('deep-merge authConfig: type conflict with local credentials keeps local and discloses', async () => {
    const now = Date.now()
    const localConfigured = JSON.stringify({ type: 'iam-aws', region: 'eu-west-1' })
    const backed = JSON.stringify({ type: 'api-key-aws', region: 'us-west-2' })
    dbh.sqlite
      .prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      )
      .run('aws-bedrock', 'AWS Bedrock', localConfigured, 'o-local', now, now)
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      ).run('aws-bedrock', 'AWS Bedrock', backed, 'o-backup', now, now)
    })

    const result = (await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })) as { degradedToSkips: { table: string; reason: string }[] }

    const row = dbh.sqlite.prepare(`SELECT auth_config FROM user_provider WHERE provider_id = 'aws-bedrock'`).get() as {
      auth_config: string
    }
    const auth = JSON.parse(row.auth_config) as { type: string; region: string }
    expect(auth.type).toBe('iam-aws')
    expect(auth.region).toBe('eu-west-1')
    expect(
      result.degradedToSkips.some(
        (d) => d.table === 'user_provider' && d.reason.includes('type conflict') && d.reason.includes('iam-aws')
      )
    ).toBe(true)
  })

  it('deep-merge authConfig: nested empty credentials shell still counts as seeder skeleton', async () => {
    // Vertex UI shape: credentials:{privateKey:'',clientEmail:''} must NOT defeat skeleton detection.
    const now = Date.now()
    const skeleton = JSON.stringify({
      type: 'iam-gcp',
      project: '',
      location: '',
      credentials: { privateKey: '', clientEmail: '' }
    })
    const backed = JSON.stringify({ type: 'oauth', accessToken: 'tok-from-backup', refreshToken: 'ref' })
    dbh.sqlite
      .prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      )
      .run('vertexai', 'Vertex AI', skeleton, 'o-local', now, now)
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      ).run('vertexai', 'Vertex AI', backed, 'o-backup', now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    const row = dbh.sqlite.prepare(`SELECT auth_config FROM user_provider WHERE provider_id = 'vertexai'`).get() as {
      auth_config: string
    }
    const auth = JSON.parse(row.auth_config) as { type: string; accessToken?: string }
    expect(auth.type).toBe('oauth')
    expect(auth.accessToken).toBe('tok-from-backup')
  })

  it('deep-merge authConfig: nested typeConflict propagates to degradedToSkips', async () => {
    // Same parent type, nested credentials.type conflict — keep local nested + disclose.
    const now = Date.now()
    const localConfigured = JSON.stringify({
      type: 'iam-gcp',
      project: 'p',
      credentials: { type: 'service_account', privateKey: 'local-key' }
    })
    const backed = JSON.stringify({
      type: 'iam-gcp',
      project: 'p',
      credentials: { type: 'external_account', privateKey: 'backup-key' }
    })
    dbh.sqlite
      .prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      )
      .run('vertexai', 'Vertex AI', localConfigured, 'o-local', now, now)
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO user_provider (provider_id, name, api_keys, auth_config, is_enabled, order_key, created_at, updated_at)
         VALUES (?, ?, '[]', ?, 1, ?, ?, ?)`
      ).run('vertexai', 'Vertex AI', backed, 'o-backup', now, now)
    })

    const result = (await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })) as { degradedToSkips: { table: string; reason: string }[] }

    const row = dbh.sqlite.prepare(`SELECT auth_config FROM user_provider WHERE provider_id = 'vertexai'`).get() as {
      auth_config: string
    }
    const auth = JSON.parse(row.auth_config) as {
      type: string
      credentials: { type: string; privateKey: string }
    }
    expect(auth.credentials.type).toBe('service_account')
    expect(auth.credentials.privateKey).toBe('local-key')
    expect(
      result.degradedToSkips.some(
        (d) => d.table === 'user_provider' && d.reason.includes('type conflict') && d.reason.includes('service_account')
      )
    ).toBe(true)
  })

  it('discloses nested member skip when parent member produced no anchors', async () => {
    // Backup has a chat_message_file_ref but no message rows → nested member parent anchors
    // empty → previously silent skip; now disclosed.
    seedBackup(
      (db) => {
        insertTopic(db, 'tpc-orphan-fr')
        insertChatMessageFileRef(db, 'fr-orphan', 'msg-missing', 'fe-any')
      },
      { foreignKeys: false }
    )

    const result = (await runMerge(topCtx())) as { degradedToSkips: { table: string; reason: string }[] }
    expect(
      result.degradedToSkips.some(
        (d) =>
          d.table === 'chat_message_file_ref' && d.reason.includes('parent member') && d.reason.includes('no anchor')
      )
    ).toBe(true)
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

  it('throws MergeStrategyNotImplementedError for OVERWRITE/RENAME userStrategy (fail-loud)', async () => {
    // FIELD_MERGE is implemented; OVERWRITE/RENAME still fail loud.
    await expect(
      runMerge({
        backupDbPath: backupPath,
        domains: ['TOPICS'],
        userStrategy: 'OVERWRITE',
        skippedFileEntryIds: new Set<string>(),
        stagedFileEntryIds: new Set<string>()
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
      skippedFileEntryIds: new Set(['fe-skip']),
      stagedFileEntryIds: new Set<string>()
    })

    expect(result).toMatchObject({ degradedToSkips: [] })
    expect(countRows('file_entry')).toBe(before + 1) // only fe-keep lands
    const ids = (dbh.sqlite.prepare(`SELECT id FROM file_entry`).all() as { id: string }[]).map((r) => r.id)
    expect(ids).toContain('fe-keep')
    expect(ids).not.toContain('fe-skip')
  })

  it('SKIPs file_entry roots that collide on lower(external_path) (expression UNIQUE)', async () => {
    // Work has file_entry 'fe-local' with externalPath '/tmp/dup'; backup has a DIFFERENT
    // id with the same case-insensitive path. Expression UNIQUE is folded into SKIP
    // (local wins) — not a whole-restore abort.
    insertFileEntry(dbh.sqlite, 'fe-local', '/tmp/dup')
    seedBackup((db) => insertFileEntry(db, 'fe-backup', '/tmp/dup'))

    const result = await runMerge({
      backupDbPath: backupPath,
      domains: ['FILE_STORAGE'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })
    expect(result).toMatchObject({ degradedToSkips: [] })
    const ids = (dbh.sqlite.prepare(`SELECT id FROM file_entry`).all() as { id: string }[]).map((r) => r.id)
    expect(ids).toContain('fe-local')
    expect(ids).not.toContain('fe-backup')
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
    // PROVIDERS is natural-key (FIELD_MERGE default). An explicit SKIP opts out → every
    // backup row skipped (local survives), no throw.
    const result = await runMerge({
      backupDbPath: backupPath,
      domains: ['PROVIDERS'],
      userStrategy: 'SKIP',
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
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

    // The pipeline ran rebuildFts → assertFtsIntegrity in-tx (no throw during merge
    // = the index was consistent at COMMIT). Re-check externally to confirm it still matches
    // the imported content after the connection re-enters autocommit.
    expect(() => assertFtsIntegrity(dbh.sqlite)).not.toThrow()
  })

  it('skips pin rows whose polymorphic entityType maps outside selected domains', async () => {
    const now = Date.now()
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO pin (id, entity_type, entity_id, order_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('pin-knowledge', 'knowledge', 'kb-1', 'o1', now, now)
      db.prepare(
        `INSERT INTO pin (id, entity_type, entity_id, order_key, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`
      ).run('pin-topic', 'topic', 'tpc-1', 'o2', now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      // lite-shaped: TOPICS selected, KNOWLEDGE not
      domains: ['TAGS_GROUPS', 'TOPICS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    expect(dbh.sqlite.prepare(`SELECT id FROM pin WHERE id = 'pin-knowledge'`).get()).toBeUndefined()
    expect(dbh.sqlite.prepare(`SELECT id FROM pin WHERE id = 'pin-topic'`).get()).toBeDefined()
  })

  it('SKIPs a uuid-entity root that collides on a secondary UNIQUE (note rootPath,path)', async () => {
    // note is natural-key in production (identityKey rootPath+path). Force the secondary-UNIQUE
    // fold by planting a local note under the same overlay key with a different uuid — if the
    // engine only checked PK it would INSERT and UNIQUE-abort.
    const now = Date.now()
    dbh.sqlite
      .prepare(
        `INSERT INTO note (id, root_path, path, is_starred, is_expanded, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`
      )
      .run('note-local', '/notes', 'a.md', now, now)
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO note (id, root_path, path, is_starred, is_expanded, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`
      ).run('note-backup', '/notes', 'a.md', now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      domains: ['PREFERENCES'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    const rows = dbh.sqlite
      .prepare(`SELECT id, is_starred FROM note WHERE root_path='/notes' AND path='a.md'`)
      .all() as {
      id: string
      is_starred: number
    }[]
    expect(rows).toEqual([{ id: 'note-local', is_starred: 1 }]) // local wins, no UNIQUE abort
  })

  it('excludes platformSpecificKeys preference rows on fresh-target backfill (§6.1)', async () => {
    seedBackup((db) => {
      const now = Date.now()
      db.prepare(
        `INSERT INTO preference (scope, key, value, created_at, updated_at) VALUES ('default', ?, ?, ?, ?)`
      ).run('feature.notes.path', JSON.stringify('/Users/source/Notes'), now, now)
      db.prepare(
        `INSERT INTO preference (scope, key, value, created_at, updated_at) VALUES ('default', ?, ?, ?, ?)`
      ).run('shortcut.zoom_in', JSON.stringify('CommandOrControl+='), now, now)
      db.prepare(
        `INSERT INTO preference (scope, key, value, created_at, updated_at) VALUES ('default', ?, ?, ?, ?)`
      ).run('theme.mode', JSON.stringify('dark'), now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      domains: ['PREFERENCES'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })

    expect(dbh.sqlite.prepare(`SELECT key FROM preference WHERE key = 'feature.notes.path'`).get()).toBeUndefined()
    expect(dbh.sqlite.prepare(`SELECT key FROM preference WHERE key = 'shortcut.zoom_in'`).get()).toBeUndefined()
    expect(
      (dbh.sqlite.prepare(`SELECT value FROM preference WHERE key = 'theme.mode'`).get() as { value: string }).value
    ).toBe(JSON.stringify('dark'))
  })

  it('skips all note overlays when includeFiles=false (lite §3.5)', async () => {
    const now = Date.now()
    seedBackup((db) => {
      db.prepare(
        `INSERT INTO note (id, root_path, path, is_starred, is_expanded, created_at, updated_at)
         VALUES (?, ?, ?, 1, 0, ?, ?)`
      ).run('note-dangling', '/notes', 'missing.md', now, now)
    })

    await runMerge({
      backupDbPath: backupPath,
      domains: ['PREFERENCES'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>(),
      includeFiles: false
    })

    expect(dbh.sqlite.prepare(`SELECT id FROM note WHERE id = 'note-dangling'`).get()).toBeUndefined()
  })

  it('prunes a nullable onDelete=no-action FK instead of SET NULL (knowledge_base.embedding_model_id)', async () => {
    const now = Date.now()
    seedBackup(
      (db) => {
        db.prepare(
          `INSERT INTO knowledge_base (
             id, name, embedding_model_id, dimensions, status, chunk_size, chunk_overlap, created_at, updated_at
           ) VALUES (?, ?, ?, 1536, 'completed', 500, 50, ?, ?)`
        ).run('kb-1', 'kb', 'um-missing', now, now)
      },
      { foreignKeys: false }
    )

    const result = (await runMerge({
      backupDbPath: backupPath,
      domains: ['KNOWLEDGE'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>()
    })) as { degradedToSkips: { table: string; reason: string }[] }

    expect(dbh.sqlite.prepare(`SELECT id FROM knowledge_base WHERE id = 'kb-1'`).get()).toBeUndefined()
    expect(result.degradedToSkips.some((s) => s.table === 'knowledge_base' && s.reason.includes('pruned'))).toBe(true)
  })
  it('discloses message.data fileEntryId when blob is not in stagedFileEntryIds', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-att')
      const now = Date.now()
      db.prepare(
        `INSERT INTO message (id, parent_id, topic_id, role, data, searchable_text, status, siblings_group_id, model_id, created_at, updated_at)
         VALUES (?, NULL, ?, 'root', ?, '', 'success', 0, NULL, ?, ?)`
      ).run(
        'msg-att',
        'tpc-att',
        JSON.stringify({ parts: [{ type: 'file', fileEntryId: 'fe-missing-blob' }] }),
        now,
        now
      )
    })

    const disclosed = (await runMerge({
      backupDbPath: backupPath,
      domains: ['TOPICS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set<string>() // DB-only → disclose all
    })) as { degradedToSkips: { table: string; reason: string }[] }

    expect(disclosed.degradedToSkips.some((d) => d.table === 'message' && d.reason.includes('not staged'))).toBe(true)
  })

  it('does not disclose fileEntryId when the blob id is in stagedFileEntryIds', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-att2')
      const now = Date.now()
      db.prepare(
        `INSERT INTO message (id, parent_id, topic_id, role, data, searchable_text, status, siblings_group_id, model_id, created_at, updated_at)
         VALUES (?, NULL, ?, 'root', ?, '', 'success', 0, NULL, ?, ?)`
      ).run('msg-att2', 'tpc-att2', JSON.stringify({ parts: [{ type: 'file', fileEntryId: 'fe-staged' }] }), now, now)
    })

    const result = (await runMerge({
      backupDbPath: backupPath,
      domains: ['TOPICS'],
      skippedFileEntryIds: new Set<string>(),
      stagedFileEntryIds: new Set(['fe-staged'])
    })) as { degradedToSkips: { table: string; reason: string }[] }

    expect(result.degradedToSkips.filter((d) => d.reason.includes('not staged'))).toEqual([])
  })
})
