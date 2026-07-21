/**
 * e2e-restore real-data / backfill + degrade — AC: `__tests__/e2e/restore.full.test.ts`
 *
 * Proves the restore spine completes on a REAL-shaped multi-domain archive — the case the
 * lite e2e deliberately avoids (topics without messages). Covers the cross-domain FK
 * topology that used to abort the merge wholesale:
 * - message.modelId → user_model (PROVIDERS, natural-key aggregate member)
 * - agent_session.workspaceId → agent_workspace (natural-key root, NOT NULL cascade)
 *
 * Scenario A (fresh install): every natural-key aggregate is absent locally → BACKFILL.
 * Preferences / providers+API keys / workspaces / tags all restore; cross-domain FKs
 * resolve against the backfilled rows (backup PKs preserved).
 *
 * Scenario B (conflicting local data): natural-key conflicts SKIP (local wins) and the
 * repair pass degrades unresolvable refs (nullable → SET NULL, NOT NULL → prune) so the
 * restore still completes FK-clean. Field-level merging is the FIELD_MERGE milestone.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import type { DbService } from '@main/data/db/DbService'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../../admitArchive'
import { assembleArchive } from '../../archive'
import { ImportOrchestrator, type ImportOrchestratorDeps } from '../../ImportOrchestrator'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../../manifest'
import { MergeEngine } from '../../merge'
import { setBackupInProgress } from '../../quiesceGate'

const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../migrations/sqlite-drizzle'
)

const DOMAINS = ['PREFERENCES', 'PROVIDERS', 'TAGS_GROUPS', 'AGENTS', 'TOPICS'] as const

describe('e2e-restore real data / backfill + degrade', () => {
  const dbh = setupTestDatabase()
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
    archivePath = join(tmpDir, 'backup.cbu')
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
    seedRow(db, 'preference', { scope: 'default', key: 'ui.theme', value: '"dark"' })
    seedRow(db, 'user_provider', {
      provider_id: 'openai',
      name: 'backup-name',
      api_keys: JSON.stringify([{ id: 'k1', key: 'key-from-backup' }]),
      order_key: 'o-p1'
    })
    seedRow(db, 'user_model', {
      id: 'openai::gpt-4o',
      provider_id: 'openai',
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
      model_id: 'openai::gpt-4o'
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
    domains: [...DOMAINS],
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
    // Live DB is empty (fresh install). Everything must come back from the archive.
    seedBackup(seedRealBackupData)

    const work = await runRestore('rst-e2e-fresh')
    try {
      // PREFERENCES backfilled — a migration restore must not silently drop settings.
      const pref = work.prepare(`SELECT value FROM preference WHERE scope='default' AND key='ui.theme'`).get() as {
        value: string
      }
      expect(pref.value).toBe('"dark"')
      // PROVIDERS backfilled including credentials.
      const provider = work.prepare(`SELECT api_keys FROM user_provider WHERE provider_id='openai'`).get() as {
        api_keys: string
      }
      expect(provider.api_keys).toContain('key-from-backup')
      expect(work.prepare(`SELECT id FROM user_model WHERE id='openai::gpt-4o'`).get()).toBeDefined()
      // TOPICS imported with the cross-domain model link INTACT (resolves to backfilled model).
      const msg = work.prepare(`SELECT model_id FROM message WHERE id='msg-1'`).get() as { model_id: string }
      expect(msg.model_id).toBe('openai::gpt-4o')
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

  it('conflicting local data: restore completes FK-clean, local wins, unresolvable refs degrade', async () => {
    seedBackup(seedRealBackupData)
    // Local data conflicting on every natural key (same identity, different values/uuids).
    seedRow(dbh.sqlite, 'preference', { scope: 'default', key: 'ui.theme', value: '"light"' })
    seedRow(dbh.sqlite, 'user_provider', {
      provider_id: 'openai',
      name: 'local-name',
      api_keys: JSON.stringify([{ id: 'kl', key: 'key-local' }]),
      order_key: 'o-lp1'
    })
    seedRow(dbh.sqlite, 'tag', { id: 'tag-local', name: 'work' })
    seedRow(dbh.sqlite, 'agent_workspace', { id: 'ws-local', name: 'proj', path: '/Users/me/proj', order_key: 'o-lw1' })

    const work = await runRestore('rst-e2e-overlap')
    try {
      // Local values win on every conflicted natural-key row (FIELD_MERGE pending).
      expect(work.prepare(`SELECT value FROM preference WHERE key='ui.theme'`).get()).toMatchObject({
        value: '"light"'
      })
      const provider = work.prepare(`SELECT name, api_keys FROM user_provider WHERE provider_id='openai'`).get() as {
        name: string
        api_keys: string
      }
      expect(provider.name).toBe('local-name')
      expect(provider.api_keys).toContain('key-local')
      // Conflicted provider aggregate SKIPped wholesale → backup model not imported →
      // message.model_id degraded to NULL by the repair pass (row survives).
      expect(work.prepare(`SELECT id FROM user_model WHERE id='openai::gpt-4o'`).get()).toBeUndefined()
      expect(work.prepare(`SELECT model_id FROM message WHERE id='msg-1'`).get()).toMatchObject({ model_id: null })
      // Workspace conflicts under a different uuid → backup workspace not imported; the
      // session's NOT NULL workspace FK cannot resolve → session pruned (B1 identity
      // propagation will rewrite it to ws-local instead).
      const workspaces = work.prepare(`SELECT id FROM agent_workspace ORDER BY id`).all() as { id: string }[]
      expect(workspaces).toEqual([{ id: 'ws-local' }])
      expect(work.prepare(`SELECT id FROM agent_session WHERE id='sess-1'`).get()).toBeUndefined()
      // Tag: local uuid survives alone.
      const tags = work.prepare(`SELECT id FROM tag WHERE name='work'`).all() as { id: string }[]
      expect(tags).toEqual([{ id: 'tag-local' }])
      // The topic itself still restored — a conflicted credential domain no longer aborts
      // the whole merge.
      expect(work.prepare(`SELECT id FROM topic WHERE id='tpc-1'`).get()).toBeDefined()
      expect(work.pragma('foreign_key_check')).toEqual([])
    } finally {
      work.close()
    }
  })
})
