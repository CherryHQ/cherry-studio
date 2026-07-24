/**
 * e2e-restore lite / SKIP DB only — AC: `__tests__/e2e/restore.lite.test.ts`
 *
 * Scope (intentionally narrow):
 * - Proves the DB restore spine end-to-end: partial quiesce → fingerprint →
 *   snapshot → planResources → MergeEngine SKIP/INSERT → migrate → seal → journal.
 * - Uses a synthetic **lite** TOPICS-only `.cherrybackup` (no file / knowledge / notes blobs).
 * - planResources early-returns empty for lite (same DB-only journal as packaged BackupService).
 *
 * Out of scope: file blob promotion, knowledge/notes stagers, explicit OVERWRITE/RENAME
 * strategies, and the multi-domain backfill/conflict matrix (see `restore.full.test.ts`).
 */
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { isBackupInProgress, setBackupInProgress } from '@main/data/db/backup/quiesceGate'
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
import { MergeEngine } from '../../merge/MergeEngine'
import { resolvePreset } from '../../presets'
import { planResources } from '../../resourcePlanning'

const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../migrations/sqlite-drizzle'
)

describe('e2e-restore lite / SKIP DB only', () => {
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let stagingRoot: string
  let journalPath: string
  let liveDbPath: string
  let archivePath: string
  let backupDbPath: string
  let jobManagerPause: ReturnType<typeof vi.fn>
  let jobManagerDrain: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-e2e-restore-lite-'))
    stagingRoot = join(tmpDir, 'restore-staging')
    journalPath = join(tmpDir, 'restore-journal.json')
    liveDbPath = dbh.sqlite.name
    archivePath = join(tmpDir, 'backup.cherrybackup')
    backupDbPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupDbPath)
    setBackupInProgress(false)

    jobManagerPause = vi.fn(() => ({ dispose: vi.fn() }))
    jobManagerDrain = vi.fn(async () => ({ stragglerIds: [] as string[] }))
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

  const seedBackup = (seed: (db: Database.Database) => void): void => {
    const db = new Database(backupDbPath)
    try {
      db.pragma('foreign_keys = ON')
      db.transaction(seed)(db)
    } finally {
      db.close()
    }
  }

  const insertTopic = (db: Database.Database, id: string, name = `topic-${id}`): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO topic (id, name, is_name_manually_edited, order_key, created_at, updated_at)
       VALUES (?, ?, 0, ?, ?, ?)`
    ).run(id, name, `order-${id}`, now, now)
  }

  const buildLiteManifest = (domains: BackupManifest['domains'] = [...resolvePreset('lite')]): BackupManifest => ({
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    preset: 'lite',
    domains,
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

  const packArchive = async (domains?: BackupManifest['domains']): Promise<void> => {
    await assembleArchive(archivePath, { manifest: buildLiteManifest(domains), dbCopyPath: backupDbPath })
  }

  /**
   * Production-shaped deps: partial quiesce sets BACKUP_IN_PROGRESS + JobManager
   * pause/drain; real planResources (lite → empty plan).
   */
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
      jobManagerPause('restore-quiesce')
      await jobManagerDrain({ timeoutMs: 5000 })
    },
    mergeBackupIntoWork: (workSqlite, workDb, ctx) => {
      expect(workSqlite.name).not.toBe(liveDbPath)
      expect(workSqlite.name.endsWith('work.sqlite')).toBe(true)
      return new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, ctx)
    },
    planResources,
    planRoots: {
      files: join(tmpDir, 'Data', 'Files'),
      knowledge: join(tmpDir, 'Data', 'KnowledgeBase'),
      skills: join(tmpDir, 'Data', 'Skills'),
      notes: () => undefined
    }
  })

  it('roundtrips lite SKIP DB spine: quiesce → merge SKIP → staged journal (no file blobs)', async () => {
    insertTopic(dbh.sqlite, 'tpc-local', 'keep-local')
    seedBackup((db) => {
      insertTopic(db, 'tpc-local', 'from-backup') // same PK → SKIP keeps local
      insertTopic(db, 'tpc-new', 'imported') // new PK → INSERT
    })
    await packArchive()

    const orch = new ImportOrchestrator(makeDeps())
    const result = await orch.importBackup({ archivePath, restoreId: 'rst-e2e-lite' })

    expect(result.restoreId).toBe('rst-e2e-lite')
    expect(isBackupInProgress()).toBe(true) // flag held until caller releases (BackupService finally)
    expect(jobManagerPause).toHaveBeenCalledWith('restore-quiesce')
    expect(jobManagerDrain).toHaveBeenCalled()

    const journal = readRestoreJournal()
    expect(journal.kind).toBe('ok')
    if (journal.kind !== 'ok') return
    expect(journal.journal.state).toBe('staged')
    expect(journal.journal.restoreId).toBe('rst-e2e-lite')
    expect(journal.journal.fileResources).toEqual([]) // lite / SKIP DB only — no blob staging

    const workRo = new Database(join(stagingRoot, 'rst-e2e-lite', 'work.sqlite'), { readonly: true })
    try {
      const local = workRo.prepare(`SELECT name FROM topic WHERE id = 'tpc-local'`).get() as { name: string }
      expect(local.name).toBe('keep-local') // SKIP: local wins
      const imported = workRo.prepare(`SELECT name FROM topic WHERE id = 'tpc-new'`).get() as { name: string }
      expect(imported.name).toBe('imported') // INSERT
      expect(existsSync(join(stagingRoot, 'rst-e2e-lite', 'work.sqlite-wal'))).toBe(false)
    } finally {
      workRo.close()
    }

    // Live DB untouched (D-model) — merge wrote detached work.sqlite only.
    expect((dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM topic`).get() as { c: number }).c).toBe(1)
    expect((dbh.sqlite.prepare(`SELECT name FROM topic WHERE id = 'tpc-local'`).get() as { name: string }).name).toBe(
      'keep-local'
    )
  })

  it('strips note overlays on lite restore — no dangling starred/expanded state (§3.5)', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-1')
      const now = Date.now()
      db.prepare(
        `INSERT INTO note (id, root_path, path, is_starred, is_expanded, created_at, updated_at)
         VALUES (?, ?, ?, 1, 1, ?, ?)`
      ).run('note-dangling', '/notes', 'ghost.md', now, now)
      db.prepare(
        `INSERT INTO preference (scope, key, value, created_at, updated_at) VALUES ('default', ?, ?, ?, ?)`
      ).run('feature.notes.path', JSON.stringify('/Users/source/Notes'), now, now)
      db.prepare(
        `INSERT INTO preference (scope, key, value, created_at, updated_at) VALUES ('default', ?, ?, ?, ?)`
      ).run('theme.mode', JSON.stringify('dark'), now, now)
    })
    await packArchive()

    const orch = new ImportOrchestrator(makeDeps())
    await orch.importBackup({ archivePath, restoreId: 'rst-e2e-lite-notes' })

    const workRo = new Database(join(stagingRoot, 'rst-e2e-lite-notes', 'work.sqlite'), { readonly: true })
    try {
      expect((workRo.prepare(`SELECT COUNT(*) AS c FROM note`).get() as { c: number }).c).toBe(0)
      expect(workRo.prepare(`SELECT key FROM preference WHERE key = 'feature.notes.path'`).get()).toBeUndefined()
      expect(
        (workRo.prepare(`SELECT value FROM preference WHERE key = 'theme.mode'`).get() as { value: string }).value
      ).toBe(JSON.stringify('dark'))
    } finally {
      workRo.close()
    }
  })
})
