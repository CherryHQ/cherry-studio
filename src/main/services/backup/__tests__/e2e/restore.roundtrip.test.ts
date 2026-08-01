/**
 * e2e restore roundtrip — REAL export → REAL restore → runRestorePromotion preboot.
 *
 * The only test chaining a real ExportOrchestrator-produced .cherrybackup through a
 * real ImportOrchestrator restore AND the standalone runRestorePromotion preboot:
 * - restore.b1.roundtrip stops at work.sqlite (no promote)
 * - restorePromotion unit tests don't consume a real archive
 *
 * Verifies the full promote path: admission gate (fingerprint + chain) → executeForward
 * renames work→live, the live DB holds the backup row (fresh-install backfill), and the
 * journal reaches 'completed'. The live DB is an independent copy of the migrated
 * harness schema (not the harness connection itself): promotion runs in the preboot
 * zero-connection window, so the live connection is checkpointed + closed before
 * runRestorePromotion — a held handle would block the live→aside / work→live renames
 * on Windows. Verification reopens live under a fresh Database.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { isBackupInProgress, setBackupInProgress } from '@main/data/db/backup/quiesceGate'
import type { DbService } from '@main/data/db/DbService'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { runRestorePromotion } from '@main/data/db/restore/restorePromotion'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../../admitArchive'
import { ExportOrchestrator } from '../../ExportOrchestrator'
import { ImportOrchestrator } from '../../ImportOrchestrator'
import { MergeEngine } from '../../merge/MergeEngine'
import { planResources } from '../../resourcePlanning'
import { SqliteBackupStripper } from '../../SqliteBackupStripper'

const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../migrations/sqlite-drizzle'
)

describe('e2e restore roundtrip (export → restore → promotion)', () => {
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let liveDbPath: string
  let liveConn: Database.Database
  let stagingRoot: string
  let journalPath: string
  let archivePath: string
  let exportTmpDir: string
  let jobManagerPause: ReturnType<typeof vi.fn>
  let jobManagerDrain: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-e2e-roundtrip-'))
    liveDbPath = join(tmpDir, 'live.db')
    // Copy the migrated schema (+ fresh-install seed) into an independent live DB we
    // own. The harness DB stays open only as the schema source; this live connection
    // is closed before promotion to mirror the preboot zero-connection window.
    await dbh.sqlite.backup(liveDbPath)
    liveConn = new Database(liveDbPath)
    stagingRoot = join(tmpDir, 'restore-staging')
    journalPath = join(tmpDir, 'restore-journal.json')
    archivePath = join(tmpDir, 'backup.cherrybackup')
    exportTmpDir = join(tmpDir, 'export-tmp')
    mkdirSync(exportTmpDir, { recursive: true })
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
        case 'app.database.migrations':
          return MIGRATIONS_FOLDER
        default:
          return join(tmpDir, key)
      }
    })
  })

  afterEach(() => {
    setBackupInProgress(false)
    vi.restoreAllMocks()
    try {
      liveConn.close()
    } catch {
      // promotion already closed it
    }
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  const seedTopic = (id: string, name: string): void => {
    const now = Date.now()
    liveConn
      .prepare(
        `INSERT INTO topic (id, name, is_name_manually_edited, order_key, created_at, updated_at)
         VALUES (?, ?, 0, ?, ?, ?)`
      )
      .run(id, name, `order-${id}`, now, now)
  }

  it('promotes a real exported archive into a fresh live DB (backfill + completed journal)', async () => {
    // 1. Seed a source row, then export a REAL full archive from the live DB.
    seedTopic('tpc-exported', 'from-backup')
    const exportOrch = new ExportOrchestrator({
      dbService: { createSnapshot: (dest: string) => void snapshotTo(liveConn, dest) },
      registry,
      tempDir: exportTmpDir,
      knowledgeRoot: join(tmpDir, 'kb'),
      skillsRoot: join(tmpDir, 'skills'),
      notesRoot: () => undefined,
      stripper: new SqliteBackupStripper()
    })
    await exportOrch.exportBackup({
      preset: 'full',
      outputPath: archivePath,
      restoreId: 'rst-roundtrip',
      producerAppVersion: '1.0.0-test',
      schemaMigrationId: '0001_x.sql',
      overwrite: true
    })

    // 2. Wipe the source row → fresh-install state (the restore backfill target).
    //    No child rows reference this topic, so FK stays ON (production-faithful).
    liveConn.prepare('DELETE FROM topic').run()
    expect(liveConn.prepare('SELECT count(*) AS c FROM topic').get().c).toBe(0)

    // 3. REAL restore → staged journal (work.sqlite holds the merged backup rows).
    const importOrch = new ImportOrchestrator({
      dbService: {
        checkpointTruncate: () => checkpointTruncateAssert(liveConn),
        createSnapshot: (workPath: string) => snapshotTo(liveConn, workPath)
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
      mergeBackupIntoWork: (workSqlite, workDb, ctx) =>
        new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, ctx),
      planResources,
      planRoots: {
        files: join(tmpDir, 'Data', 'Files'),
        knowledge: join(tmpDir, 'Data', 'KnowledgeBase'),
        skills: join(tmpDir, 'Data', 'Skills'),
        notes: () => undefined
      }
    })
    const result = await importOrch.importBackup({ archivePath, restoreId: 'rst-roundtrip' })
    expect(result.restoreId).toBe('rst-roundtrip')
    // Partial-quiesce seam engaged: BACKUP_IN_PROGRESS held + JobManager paused/drained.
    expect(isBackupInProgress()).toBe(true)
    expect(jobManagerPause).toHaveBeenCalledWith('restore-quiesce')
    expect(jobManagerDrain).toHaveBeenCalled()

    let read = readRestoreJournal()
    expect(read.kind).toBe('ok')
    if (read.kind === 'ok') expect(read.journal.state).toBe('staged')

    // 4. Mirror the preboot zero-connection window: checkpoint + close the live
    //    connection before promotion so the renames aren't blocked by a held handle.
    checkpointTruncateAssert(liveConn)
    liveConn.close()

    await runRestorePromotion()
    // The restore window stays sealed through promotion (released only by BackupService
    // finally / process exit), not by the preboot gate itself.
    expect(isBackupInProgress()).toBe(true)

    // 5. Promotion reopened live under a new inode — read via a fresh Database.
    //    The backup row is backfilled + the DB passes integrity_check.
    read = readRestoreJournal()
    expect(read.kind).toBe('ok')
    if (read.kind === 'ok') expect(read.journal.state).toBe('completed')

    const live = new Database(liveDbPath)
    try {
      const row = live.prepare('SELECT name FROM topic WHERE id = ?').get('tpc-exported') as
        | { name: string }
        | undefined
      expect(row?.name).toBe('from-backup')
      expect(live.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      live.close()
    }
  })
})
