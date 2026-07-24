/**
 * e2e-restore real-data / FIELD_MERGE + degrade — AC: `__tests__/e2e/restore.full.test.ts`
 *
 * Proves the restore spine completes on a REAL-shaped multi-domain archive — the case the
 * lite e2e deliberately avoids (topics without messages). Covers the cross-domain FK
 * topology that used to abort the merge wholesale:
 * - message.modelId → user_model (PROVIDERS, natural-key aggregate member)
 * - agent_session.workspaceId → agent_workspace (natural-key root, NOT NULL cascade)
 *
 * Scenario A (production-shaped fresh install via seeders): backup-only natural-key rows
 * INSERT (provider id that does not collide with PresetProviderSeeder); cross-domain FKs
 * resolve against the inserted rows. Seeder rows remain intact.
 *
 * Scenario B (conflicting local data): natural-key FIELD_MERGE (local non-empty columns kept,
 * backup fills SQL NULL / policy-empty; absent members INSERT) + settings-class SKIP for
 * preference/note. Non-deterministic PK conflicts keep local PK; orphan owning FKs degrade
 * (nullable → SET NULL, NOT NULL → prune). uuid-entity SKIP unchanged.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { setBackupInProgress } from '@main/data/db/backup/quiesceGate'
import type { DbService } from '@main/data/db/DbService'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { userProviderTable } from '@main/data/db/schemas/userProvider'
import type { DbType, ISeeder } from '@main/data/db/types'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../../admitArchive'
import { assembleArchive } from '../../archive'
import { ImportOrchestrator, type ImportOrchestratorDeps } from '../../ImportOrchestrator'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../../manifest'
import { MergeEngine } from '../../merge/MergeEngine'
import { resolvePreset } from '../../presets'

const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../migrations/sqlite-drizzle'
)

const DOMAINS = ['PREFERENCES', 'PROVIDERS', 'TAGS_GROUPS', 'AGENTS', 'TOPICS'] as const

/** Minimal production-shaped seeder: preset openai row (no registry file dependency). */
const freshInstallSeeder: ISeeder = {
  name: 'e2e-fresh-openai',
  version: '1',
  description: 'openai provider placeholder mimicking PresetProviderSeeder',
  run(db: DbType): void {
    db.insert(userProviderTable)
      .values({
        providerId: 'openai',
        name: 'OpenAI',
        isEnabled: true,
        orderKey: 'o-seed-openai'
      })
      .onConflictDoNothing()
      .run()
  }
}

describe('e2e-restore real data / backfill + degrade', () => {
  // Production seeders — covers the fresh-install shape (preset providers present).
  const dbh = setupTestDatabase({ seeders: [freshInstallSeeder] })
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let stagingRoot: string
  let journalPath: string
  let liveDbPath: string
  let archivePath: string
  let backupDbPath: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-e2e-restore-full-'))
    stagingRoot = join(tmpDir, 'restore-staging')
    journalPath = join(tmpDir, 'restore-journal.json')
    liveDbPath = dbh.sqlite.name
    archivePath = join(tmpDir, 'backup.cherrybackup')
    backupDbPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupDbPath)
    setBackupInProgress(false)

    vi.spyOn(application, 'getPath').mockImplementation((key: string) => {
      switch (key) {
        case 'feature.backup.restore.file':
          return journalPath
        case 'feature.backup.restore.staging':
          return stagingRoot
        case 'app.userdata':
          return tmpDir
        case 'app.database.file':
          return liveDbPath
        default:
          return join(tmpDir, key)
      }
    })
  })

  afterEach(() => {
    setBackupInProgress(false)
    vi.restoreAllMocks()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  /**
   * Insert a row, auto-filling NOT NULL columns that have no DB default with a
   * type-appropriate dummy. `overrides` supplies PK + meaningful columns (mirrors the
   * junctionPhase helper — keeps seeds stable across schema drift).
   */
  const seedRow = (db: Database.Database, table: string, overrides: Record<string, unknown>): void => {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as {
      name: string
      type: string
      notnull: number
      dflt_value: string | null
    }[]
    const names: string[] = []
    const values: unknown[] = []
    for (const c of cols) {
      if (c.name in overrides) {
        names.push(`"${c.name}"`)
        values.push(overrides[c.name])
      } else if (c.notnull && c.dflt_value === null) {
        names.push(`"${c.name}"`)
        values.push(c.type === 'integer' ? 0 : '')
      }
    }
    db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')})`).run(...values)
  }

  /** Seed the REAL-shaped backup dataset: 5 domains with cross-domain FKs. */
  const seedRealBackupData = (db: Database.Database): void => {
    // Unique preference key — DefaultPreferences from PreferenceSeeder must not collide.
    seedRow(db, 'preference', { scope: 'default', key: 'backup.e2e.marker', value: '"from-backup"' })
    // Provider id absent from PresetProviderSeeder so Scenario A exercises BACKFILL.
    seedRow(db, 'user_provider', {
      provider_id: 'backup-only',
      name: 'backup-name',
      api_keys: JSON.stringify([{ id: 'k1', key: 'key-from-backup' }]),
      order_key: 'o-p1'
    })
    seedRow(db, 'user_model', {
      id: 'backup-only::gpt-4o',
      provider_id: 'backup-only',
      model_id: 'gpt-4o',
      name: 'GPT-4o',
      capabilities: '[]',
      order_key: 'o-m1'
    })
    seedRow(db, 'tag', { id: 'tag-backup', name: 'work' })
    seedRow(db, 'agent', { id: 'agent-1', type: 'agent', name: 'agent', instructions: 'do things' })
    seedRow(db, 'agent_workspace', { id: 'ws-backup', name: 'proj', path: '/Users/me/proj', order_key: 'o-w1' })
    seedRow(db, 'agent_session', {
      id: 'sess-1',
      agent_id: 'agent-1',
      name: 'session',
      workspace_id: 'ws-backup',
      order_key: 'o-s1'
    })
    seedRow(db, 'topic', { id: 'tpc-1', name: 'chat', order_key: 'o-t1' })
    seedRow(db, 'message', {
      id: 'msg-1',
      topic_id: 'tpc-1',
      role: 'root',
      data: JSON.stringify({ parts: [] }),
      status: 'success',
      siblings_group_id: 0,
      model_id: 'backup-only::gpt-4o'
    })
  }

  const seedBackup = (seed: (db: Database.Database) => void): void => {
    const db = new Database(backupDbPath)
    try {
      db.pragma('foreign_keys = ON')
      db.transaction(seed)(db)
    } finally {
      db.close()
    }
  }

  const buildManifest = (): BackupManifest => ({
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    preset: 'lite',
    domains: [...resolvePreset('lite')],
    includeFiles: false,
    includeKnowledgeFiles: false,
    sensitiveData: { included: true, rotated: false },
    schemaMigrationId: '0',
    producerAppVersion: '0.0.0-test',
    files: { ids: [], total: 0, totalBytes: 0 },
    knowledge: { bases: [] },
    skills: { folders: [] },
    notes: { paths: [] },
    degraded: { resources: [] }
  })

  const packArchive = async (): Promise<void> => {
    await assembleArchive(archivePath, { manifest: buildManifest(), dbCopyPath: backupDbPath })
  }

  const makeDeps = (): ImportOrchestratorDeps => ({
    dbService: {
      checkpointTruncate: () => checkpointTruncateAssert(dbh.sqlite),
      createSnapshot: (workPath: string) => snapshotTo(dbh.sqlite, workPath)
    } as unknown as DbService,
    migrationsFolder: MIGRATIONS_FOLDER,
    liveDbPath,
    restoreStagingRoot: stagingRoot,
    userData: tmpDir,
    journalPath,
    admitArchive,
    quiesceWriters: async () => {
      setBackupInProgress(true)
    },
    mergeBackupIntoWork: (workSqlite, workDb, ctx) =>
      new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, ctx),
    stageFileResources: async () => []
  })

  const runRestore = async (restoreId: string): Promise<Database.Database> => {
    await packArchive()
    const orch = new ImportOrchestrator(makeDeps())
    const result = await orch.importBackup({ archivePath, restoreId })
    expect(result.restoreId).toBe(restoreId)
    const journal = readRestoreJournal()
    expect(journal.kind).toBe('ok')
    return new Database(join(stagingRoot, restoreId, 'work.sqlite'), { readonly: true })
  }

  it('fresh install: backfills every natural-key domain with zero loss and zero FK violations', async () => {
    // Live DB has production seeders (preset providers). Backup-only rows must BACKFILL;
    // seeder rows must survive untouched.
    seedBackup(seedRealBackupData)

    const work = await runRestore('rst-e2e-fresh')
    try {
      const pref = work
        .prepare(`SELECT value FROM preference WHERE scope='default' AND key='backup.e2e.marker'`)
        .get() as {
        value: string
      }
      expect(pref.value).toBe('"from-backup"')
      // Seeder openai still present (production fresh install shape).
      expect(work.prepare(`SELECT provider_id FROM user_provider WHERE provider_id='openai'`).get()).toBeDefined()
      // Backup-only PROVIDERS backfilled including credentials.
      const provider = work.prepare(`SELECT api_keys FROM user_provider WHERE provider_id='backup-only'`).get() as {
        api_keys: string
      }
      expect(provider.api_keys).toContain('key-from-backup')
      expect(work.prepare(`SELECT id FROM user_model WHERE id='backup-only::gpt-4o'`).get()).toBeDefined()
      // TOPICS imported with the cross-domain model link INTACT (resolves to backfilled model).
      const msg = work.prepare(`SELECT model_id FROM message WHERE id='msg-1'`).get() as { model_id: string }
      expect(msg.model_id).toBe('backup-only::gpt-4o')
      // AGENTS: workspace backfilled, session imported with its NOT NULL owning FK intact.
      expect(work.prepare(`SELECT id FROM agent_workspace WHERE id='ws-backup'`).get()).toBeDefined()
      const sess = work.prepare(`SELECT workspace_id FROM agent_session WHERE id='sess-1'`).get() as {
        workspace_id: string
      }
      expect(sess.workspace_id).toBe('ws-backup')
      // TAGS_GROUPS backfilled.
      expect(work.prepare(`SELECT id FROM tag WHERE name='work'`).get()).toMatchObject({ id: 'tag-backup' })
      // Whole graph is FK-clean.
      expect(work.pragma('foreign_key_check')).toEqual([])
    } finally {
      work.close()
    }
  })

  it('conflicting local data: FIELD_MERGE keeps local non-empty + imports absent members', async () => {
    // Backup collides with seeder openai + local tag/workspace identityKeys.
    // backupDbPath is a copy of the seeded live DB — UPDATE openai (already present) rather than INSERT.
    seedBackup((db) => {
      seedRow(db, 'preference', { scope: 'default', key: 'backup.e2e.marker', value: '"from-backup"' })
      db.prepare(`UPDATE user_provider SET name = ?, api_keys = ? WHERE provider_id = 'openai'`).run(
        'backup-name',
        JSON.stringify([{ id: 'k1', key: 'key-from-backup' }])
      )
      // Ensure a backup-only model under openai that local seeder does not hold.
      if (!db.prepare(`SELECT 1 FROM user_model WHERE id = 'openai::gpt-4o-backup'`).get()) {
        seedRow(db, 'user_model', {
          id: 'openai::gpt-4o-backup',
          provider_id: 'openai',
          model_id: 'gpt-4o-backup',
          name: 'GPT-4o-backup',
          capabilities: '[]',
          order_key: 'o-m1'
        })
      }
      seedRow(db, 'tag', { id: 'tag-backup', name: 'work' })
      seedRow(db, 'agent', { id: 'agent-1', type: 'agent', name: 'agent', instructions: 'do things' })
      seedRow(db, 'agent_workspace', { id: 'ws-backup', name: 'proj', path: '/Users/me/proj', order_key: 'o-w1' })
      seedRow(db, 'agent_session', {
        id: 'sess-1',
        agent_id: 'agent-1',
        name: 'session',
        workspace_id: 'ws-backup',
        order_key: 'o-s1'
      })
      seedRow(db, 'topic', { id: 'tpc-1', name: 'chat', order_key: 'o-t1' })
      seedRow(db, 'message', {
        id: 'msg-1',
        topic_id: 'tpc-1',
        role: 'root',
        data: JSON.stringify({ parts: [] }),
        status: 'success',
        siblings_group_id: 0,
        model_id: 'openai::gpt-4o-backup'
      })
    })
    // Overlay local non-empty values on seeder openai (FIELD_MERGE keeps these).
    dbh.sqlite
      .prepare(`UPDATE user_provider SET name = ?, api_keys = ? WHERE provider_id = 'openai'`)
      .run('local-name', JSON.stringify([{ id: 'kl', key: 'key-local' }]))
    seedRow(dbh.sqlite, 'preference', { scope: 'default', key: 'backup.e2e.marker', value: '"light"' })
    seedRow(dbh.sqlite, 'tag', { id: 'tag-local', name: 'work' })
    seedRow(dbh.sqlite, 'agent_workspace', { id: 'ws-local', name: 'proj', path: '/Users/me/proj', order_key: 'o-lw1' })

    const work = await runRestore('rst-e2e-overlap')
    try {
      // preference/note: settings-class SKIP — local wins wholesale.
      expect(work.prepare(`SELECT value FROM preference WHERE key='backup.e2e.marker'`).get()).toMatchObject({
        value: '"light"'
      })
      const provider = work.prepare(`SELECT name, api_keys FROM user_provider WHERE provider_id='openai'`).get() as {
        name: string
        api_keys: string
      }
      // FIELD_MERGE: local non-empty columns kept (not wholesale SKIP).
      expect(provider.name).toBe('local-name')
      expect(provider.api_keys).toContain('key-local')
      // Absent member INSERT — custom model from backup must land (the #1 production bug).
      expect(work.prepare(`SELECT id FROM user_model WHERE id='openai::gpt-4o-backup'`).get()).toBeDefined()
      expect(work.prepare(`SELECT model_id FROM message WHERE id='msg-1'`).get()).toMatchObject({
        model_id: 'openai::gpt-4o-backup'
      })
      // Non-deterministic workspace: FIELD_MERGE keeps local PK; backup uuid not inserted;
      // session's NOT NULL workspace FK (ws-backup) cannot resolve → pruned (B1 identity
      // propagation will rewrite to ws-local instead).
      expect(work.prepare(`SELECT id FROM agent_workspace WHERE id='ws-local'`).get()).toBeDefined()
      expect(work.prepare(`SELECT id FROM agent_workspace WHERE id='ws-backup'`).get()).toBeUndefined()
      expect(work.prepare(`SELECT id FROM agent_session WHERE id='sess-1'`).get()).toBeUndefined()
      // Tag: local uuid survives alone (FIELD_MERGE keeps local PK).
      const tags = work.prepare(`SELECT id FROM tag WHERE name='work'`).all() as { id: string }[]
      expect(tags).toEqual([{ id: 'tag-local' }])
      expect(work.prepare(`SELECT id FROM topic WHERE id='tpc-1'`).get()).toBeDefined()
      expect(work.pragma('foreign_key_check')).toEqual([])
    } finally {
      work.close()
    }
  })

  it('fresh seeder: empty apiKeys filled from backup; local key preserved when present', async () => {
    // Seeder openai ships apiKeys=[] (drizzle default). Backup credentials must remote-fill.
    seedBackup((db) => {
      db.prepare(`UPDATE user_provider SET api_keys = ?, logo_key = ? WHERE provider_id = 'openai'`).run(
        JSON.stringify([{ id: 'k1', key: 'key-from-backup' }]),
        'icon:from-backup'
      )
    })

    const work = await runRestore('rst-e2e-empty-fill')
    try {
      const row = work.prepare(`SELECT api_keys, logo_key FROM user_provider WHERE provider_id='openai'`).get() as {
        api_keys: string
        logo_key: string | null
      }
      expect(row.api_keys).toContain('key-from-backup')
      expect(row.logo_key).toBe('icon:from-backup') // SQL NULL local → backup fills (deleted-vs-empty)
    } finally {
      work.close()
    }
  })

  it('authConfig deep-merge: seeder skeleton keeps type; backup fills empty credential fields', async () => {
    // M1 / M3: local skeleton {type:'iam-gcp',project:'',location:''} + backup credentials.
    seedBackup((db) => {
      if (!db.prepare(`SELECT 1 FROM user_provider WHERE provider_id = 'vertexai'`).get()) {
        seedRow(db, 'user_provider', {
          provider_id: 'vertexai',
          name: 'Vertex AI',
          api_keys: '[]',
          auth_config: JSON.stringify({ type: 'iam-gcp', project: 'backup-proj', location: 'us-central1' }),
          order_key: 'o-vertex'
        })
      } else {
        db.prepare(`UPDATE user_provider SET auth_config = ? WHERE provider_id = 'vertexai'`).run(
          JSON.stringify({ type: 'iam-gcp', project: 'backup-proj', location: 'us-central1' })
        )
      }
    })
    // Plant seeder-shaped local skeleton (type non-empty, credential fields empty).
    if (!dbh.sqlite.prepare(`SELECT 1 FROM user_provider WHERE provider_id = 'vertexai'`).get()) {
      seedRow(dbh.sqlite, 'user_provider', {
        provider_id: 'vertexai',
        name: 'Vertex AI',
        api_keys: '[]',
        auth_config: JSON.stringify({ type: 'iam-gcp', project: '', location: '' }),
        order_key: 'o-vertex-local'
      })
    } else {
      dbh.sqlite
        .prepare(`UPDATE user_provider SET auth_config = ? WHERE provider_id = 'vertexai'`)
        .run(JSON.stringify({ type: 'iam-gcp', project: '', location: '' }))
    }

    const work = await runRestore('rst-e2e-authconfig')
    try {
      const row = work.prepare(`SELECT auth_config FROM user_provider WHERE provider_id='vertexai'`).get() as {
        auth_config: string
      }
      const auth = JSON.parse(row.auth_config) as { type: string; project: string; location: string }
      expect(auth.type).toBe('iam-gcp')
      expect(auth.project).toBe('backup-proj')
      expect(auth.location).toBe('us-central1')
    } finally {
      work.close()
    }
  })

  it('authConfig deep-merge: type-mismatched skeleton takes backup whole-cell (no hybrid)', async () => {
    // local iam-aws seeder skeleton + backup api-key-aws → must restore api-key-aws, not hybrid.
    seedBackup((db) => {
      if (!db.prepare(`SELECT 1 FROM user_provider WHERE provider_id = 'aws-bedrock'`).get()) {
        seedRow(db, 'user_provider', {
          provider_id: 'aws-bedrock',
          name: 'AWS Bedrock',
          api_keys: '[]',
          auth_config: JSON.stringify({ type: 'api-key-aws', region: 'us-west-2' }),
          order_key: 'o-bedrock'
        })
      } else {
        db.prepare(`UPDATE user_provider SET auth_config = ? WHERE provider_id = 'aws-bedrock'`).run(
          JSON.stringify({ type: 'api-key-aws', region: 'us-west-2' })
        )
      }
    })
    if (!dbh.sqlite.prepare(`SELECT 1 FROM user_provider WHERE provider_id = 'aws-bedrock'`).get()) {
      seedRow(dbh.sqlite, 'user_provider', {
        provider_id: 'aws-bedrock',
        name: 'AWS Bedrock',
        api_keys: '[]',
        auth_config: JSON.stringify({ type: 'iam-aws', region: '' }),
        order_key: 'o-bedrock-local'
      })
    } else {
      dbh.sqlite
        .prepare(`UPDATE user_provider SET auth_config = ? WHERE provider_id = 'aws-bedrock'`)
        .run(JSON.stringify({ type: 'iam-aws', region: '' }))
    }

    const work = await runRestore('rst-e2e-authconfig-type')
    try {
      const row = work.prepare(`SELECT auth_config FROM user_provider WHERE provider_id='aws-bedrock'`).get() as {
        auth_config: string
      }
      const auth = JSON.parse(row.auth_config) as { type: string; region: string }
      expect(auth.type).toBe('api-key-aws')
      expect(auth.region).toBe('us-west-2')
    } finally {
      work.close()
    }
  })

  it('authConfig deep-merge: local credentials + different backup type keeps local and discloses', async () => {
    // e2e gap: keep-local type conflict must surface in degradedToSkips (not unit-only).
    seedBackup((db) => {
      if (!db.prepare(`SELECT 1 FROM user_provider WHERE provider_id = 'aws-bedrock'`).get()) {
        seedRow(db, 'user_provider', {
          provider_id: 'aws-bedrock',
          name: 'AWS Bedrock',
          api_keys: '[]',
          auth_config: JSON.stringify({ type: 'api-key-aws', region: 'us-west-2' }),
          order_key: 'o-bedrock'
        })
      } else {
        db.prepare(`UPDATE user_provider SET auth_config = ? WHERE provider_id = 'aws-bedrock'`).run(
          JSON.stringify({ type: 'api-key-aws', region: 'us-west-2' })
        )
      }
    })
    if (!dbh.sqlite.prepare(`SELECT 1 FROM user_provider WHERE provider_id = 'aws-bedrock'`).get()) {
      seedRow(dbh.sqlite, 'user_provider', {
        provider_id: 'aws-bedrock',
        name: 'AWS Bedrock',
        api_keys: '[]',
        auth_config: JSON.stringify({ type: 'iam-aws', region: 'eu-west-1' }),
        order_key: 'o-bedrock-local'
      })
    } else {
      dbh.sqlite
        .prepare(`UPDATE user_provider SET auth_config = ? WHERE provider_id = 'aws-bedrock'`)
        .run(JSON.stringify({ type: 'iam-aws', region: 'eu-west-1' }))
    }

    const workPath = join(stagingRoot, 'rst-e2e-authconfig-keep', 'work.sqlite')
    mkdirSync(join(stagingRoot, 'rst-e2e-authconfig-keep'), { recursive: true })
    snapshotTo(dbh.sqlite, workPath)
    const workSqlite = new Database(workPath)
    try {
      const workDb = drizzle({ client: workSqlite, casing: 'snake_case' })
      const result = await new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, {
        backupDbPath,
        domains: [...DOMAINS],
        skippedFileEntryIds: new Set(),
        stagedFileEntryIds: new Set()
      })
      const row = workSqlite.prepare(`SELECT auth_config FROM user_provider WHERE provider_id='aws-bedrock'`).get() as {
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
    } finally {
      workSqlite.close()
    }
  })

  it('deleted-vs-empty resurrection: local SQL NULL field is filled from backup', async () => {
    // Red line ③: intentional NULL on new machine is filled back from backup on restore.
    seedBackup((db) => {
      db.prepare(`UPDATE user_provider SET logo_key = ? WHERE provider_id = 'openai'`).run('icon:resurrected')
    })
    dbh.sqlite.prepare(`UPDATE user_provider SET logo_key = NULL WHERE provider_id = 'openai'`).run()

    const work = await runRestore('rst-e2e-resurrect')
    try {
      const row = work.prepare(`SELECT logo_key FROM user_provider WHERE provider_id='openai'`).get() as {
        logo_key: string | null
      }
      expect(row.logo_key).toBe('icon:resurrected')
    } finally {
      work.close()
    }
  })

  it('DB-only restore discloses message.data fileEntryId blobs not in stagedFileEntryIds', async () => {
    seedBackup((db) => {
      seedRow(db, 'topic', { id: 'tpc-att', name: 'chat', order_key: 'o-t1' })
      seedRow(db, 'message', {
        id: 'msg-att',
        topic_id: 'tpc-att',
        role: 'root',
        data: JSON.stringify({ parts: [{ type: 'file', fileEntryId: 'fe-blob-missing' }] }),
        status: 'success',
        siblings_group_id: 0
      })
    })

    // ImportOrchestrator logs degradations but does not return them — exercise MergeEngine
    // disclosure directly against a work snapshot (DB-only = empty stagedFileEntryIds).
    const workPath = join(stagingRoot, 'rst-e2e-fileid', 'work.sqlite')
    mkdirSync(join(stagingRoot, 'rst-e2e-fileid'), { recursive: true })
    snapshotTo(dbh.sqlite, workPath)
    const workSqlite = new Database(workPath)
    try {
      const workDb = drizzle({ client: workSqlite, casing: 'snake_case' })
      const result = await new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, {
        backupDbPath,
        domains: [...DOMAINS],
        skippedFileEntryIds: new Set(),
        stagedFileEntryIds: new Set() // DB-only → empty → disclose all
      })
      expect(result.degradedToSkips.some((d) => d.table === 'message' && d.reason.includes('not staged'))).toBe(true)
    } finally {
      workSqlite.close()
    }
  })

  it('file_entry lower(external_path) conflict SKIPs backup row (cross-device UNIQUE)', async () => {
    seedRow(dbh.sqlite, 'file_entry', {
      id: 'fe-local',
      origin: 'external',
      name: 'dup',
      external_path: '/tmp/CrossDevice'
    })
    seedBackup((db) => {
      seedRow(db, 'file_entry', {
        id: 'fe-backup',
        origin: 'external',
        name: 'dup',
        external_path: '/tmp/crossdevice' // case-insensitive collide
      })
    })

    // FILE_STORAGE not in this suite's lite-shaped DOMAINS — run MergeEngine directly.
    const workPath = join(tmpDir, 'work-file-entry.sqlite')
    snapshotTo(dbh.sqlite, workPath)
    const workSqlite = new Database(workPath)
    try {
      const workDb = drizzle({ client: workSqlite, casing: 'snake_case' })
      await new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, {
        backupDbPath,
        domains: ['FILE_STORAGE'],
        skippedFileEntryIds: new Set(),
        stagedFileEntryIds: new Set()
      })
      const ids = (workSqlite.prepare(`SELECT id FROM file_entry`).all() as { id: string }[]).map((r) => r.id)
      expect(ids).toContain('fe-local')
      expect(ids).not.toContain('fe-backup')
    } finally {
      workSqlite.close()
    }
  })
})
