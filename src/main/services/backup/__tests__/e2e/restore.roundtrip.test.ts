/**
 * e2e restore roundtrip — REAL export → REAL restore → runRestorePromotion preboot.
 *
 * The only tests chaining a real ExportOrchestrator-produced .cherrybackup through a
 * real ImportOrchestrator restore AND the standalone runRestorePromotion preboot:
 * - restore.b1.roundtrip stops at work.sqlite (no promote)
 * - restorePromotion unit tests don't consume a real archive
 *
 * Two happy paths through the full promote gate (admission: fingerprint + chain →
 * executeForward renames work→live):
 * 1. DB-only (topic): verifies the live DB holds the backfilled row + integrity_check.
 * 2. File resources (file blob + knowledge dir + skill dir): verifies the SAME promote
 *    path also runs the 'additive-moved' step — staged archive subtrees are renamed
 *    into userData, so a fresh-install restore recovers the on-disk blobs/dirs the
 *    backfilled rows reference (byte-exact, not copied).
 *
 * The live DB is an independent copy of the migrated harness schema (not the harness
 * connection itself): promotion runs in the preboot zero-connection window, so the
 * live connection is checkpointed + closed before runRestorePromotion — a held handle
 * would block the live→aside / work→live renames on Windows. Verification reopens live
 * under a fresh Database.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
import { planResources, type PlanRoots } from '../../resourcePlanning'
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
  let filesRoot: string
  let knowledgeRoot: string
  let skillsRoot: string
  let planRoots: PlanRoots
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
    // Shared roots double as the export SOURCE for file resources (knowledge/skills
    // dirs are read from here) AND the restore TARGET (planRoots): a fresh-install
    // restore promotes the staged archive subtree back into the same userData layout
    // the exporter read from. filesRoot is also the feature.files.data root so
    // resolvePhysicalPath's livePath lands inside planRoots.files.
    filesRoot = join(tmpDir, 'Data', 'Files')
    knowledgeRoot = join(tmpDir, 'Data', 'KnowledgeBase')
    skillsRoot = join(tmpDir, 'Data', 'Skills')
    mkdirSync(filesRoot, { recursive: true })
    mkdirSync(knowledgeRoot, { recursive: true })
    mkdirSync(skillsRoot, { recursive: true })
    planRoots = { files: filesRoot, knowledge: knowledgeRoot, skills: skillsRoot, notes: () => undefined }
    setBackupInProgress(false)

    jobManagerPause = vi.fn(() => ({ dispose: vi.fn() }))
    jobManagerDrain = vi.fn(async () => ({ stragglerIds: [] as string[] }))
    vi.spyOn(application, 'getPath').mockImplementation((key: string, filename?: string) => {
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
        case 'feature.files.data':
          // resolvePhysicalPath calls getPath('feature.files.data', `${id}.${ext}`) —
          // the filename MUST reach filesRoot, else planning's isPathInside(liveAbs,
          // roots.files) diverges from planRoots.files and the blob is rejected.
          return filename ? join(filesRoot, filename) : filesRoot
        default:
          return filename ? join(tmpDir, key, filename) : join(tmpDir, key)
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

  /** Insert a row auto-filling NOT NULL/no-default columns (mirrors restore.full.resources.test.ts). */
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
      dbService: { createSnapshot: (dest: string) => snapshotTo(liveConn, dest) },
      registry,
      tempDir: exportTmpDir,
      knowledgeRoot,
      skillsRoot,
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
    const topicCount = liveConn.prepare('SELECT count(*) AS c FROM topic').get() as { c: number }
    expect(topicCount.c).toBe(0)

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
      planRoots
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

  it('promotes file resources (blob + knowledge dir + skill dir) from a real archive into userData', async () => {
    // File ids double as staging path segments — admission's FileEntryIdSchema gates
    // them to UUID shape, so use a real UUID (not 'f1') for a faithful full-archive roundtrip.
    const fileId = '4efe0010-0000-4000-8000-000000000010'
    const fileExt = 'txt'
    const fileContent = 'hello-roundtrip-blob'
    const kbId = 'kb-roundtrip'
    const skillFolder = 'skill-roundtrip'
    const skillId = 'skill-id-roundtrip'
    const now = Date.now()

    // 1. Seed live DB rows + the on-disk resources they reference, then export a REAL
    //    full archive (file blob via feature.files.data; knowledge/skill dirs from roots).
    //    file_entry has CHECK constraints (fe_size_internal_only: internal → size≥0,
    //    fe_origin_consistency: internal → externalPath NULL) — seedRow overrides the
    //    gated columns rather than relying on auto-fill.
    seedRow(liveConn, 'file_entry', {
      id: fileId,
      origin: 'internal',
      name: 'roundtrip',
      ext: fileExt,
      size: fileContent.length
    })
    liveConn
      .prepare(
        `INSERT INTO knowledge_base (
           id, name, embedding_model_id, dimensions, status, chunk_size, chunk_overlap, created_at, updated_at
         ) VALUES (?, ?, NULL, NULL, 'completed', 500, 50, ?, ?)`
      )
      .run(kbId, kbId, now, now)
    liveConn
      .prepare(
        `INSERT INTO agent_global_skill (id, name, folder_name, source, tags, content_hash, is_enabled, created_at, updated_at)
         VALUES (?, ?, ?, 'local', '[]', 'h-skill', 1, ?, ?)`
      )
      .run(skillId, skillFolder, skillFolder, now, now)

    writeFileSync(application.getPath('feature.files.data', `${fileId}.${fileExt}`), fileContent)
    mkdirSync(join(knowledgeRoot, kbId), { recursive: true })
    writeFileSync(join(knowledgeRoot, kbId, 'doc.md'), 'kb-doc')
    mkdirSync(join(skillsRoot, skillFolder), { recursive: true })
    writeFileSync(join(skillsRoot, skillFolder, 'SKILL.md'), 'skill-doc')

    const exportOrch = new ExportOrchestrator({
      dbService: { createSnapshot: (dest: string) => snapshotTo(liveConn, dest) },
      registry,
      tempDir: exportTmpDir,
      knowledgeRoot,
      skillsRoot,
      notesRoot: () => undefined,
      stripper: new SqliteBackupStripper()
    })
    const { manifest } = await exportOrch.exportBackup({
      preset: 'full',
      outputPath: archivePath,
      restoreId: 'rst-files',
      producerAppVersion: '1.0.0-test',
      schemaMigrationId: '0001_x.sql',
      overwrite: true
    })
    expect(manifest.files.ids).toEqual([fileId])
    expect(manifest.knowledge.bases).toEqual([kbId])
    expect(manifest.skills.folders).toEqual([{ folderName: skillFolder, contentHash: 'h-skill' }])

    // 2. Wipe rows + on-disk resources → fresh-install state (no local row, no target on
    //    disk), so planning stages every resource (no CONFLICT / target_exists skip).
    liveConn.prepare('DELETE FROM file_entry WHERE id = ?').run(fileId)
    liveConn.prepare('DELETE FROM knowledge_base WHERE id = ?').run(kbId)
    liveConn.prepare('DELETE FROM agent_global_skill WHERE folder_name = ?').run(skillFolder)
    rmSync(application.getPath('feature.files.data', `${fileId}.${fileExt}`), { force: true })
    rmSync(join(knowledgeRoot, kbId), { recursive: true, force: true })
    rmSync(join(skillsRoot, skillFolder), { recursive: true, force: true })

    // 3. REAL restore → staged journal. planResources stages all three resources
    //    (blob-add + two dir-add) because neither a local row nor a disk target exists.
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
      planRoots
    })
    const result = await importOrch.importBackup({ archivePath, restoreId: 'rst-files' })
    expect(result.summary.toRestore).toEqual([
      { kind: 'file', count: 1 },
      { kind: 'knowledge', count: 1 },
      { kind: 'skill', count: 1 }
    ])

    let read = readRestoreJournal()
    expect(read.kind).toBe('ok')
    if (read.kind === 'ok') {
      expect(read.journal.state).toBe('staged')
      // The plan sealed three additive resources: one blob + two dirs (knowledge, skill).
      expect(read.journal.fileResources).toHaveLength(3)
      expect(read.journal.fileResources.map((r) => r.kind).sort()).toEqual(['blob-add', 'dir-add', 'dir-add'])
    }

    // 4. Mirror the preboot zero-connection window before promotion.
    checkpointTruncateAssert(liveConn)
    liveConn.close()

    await runRestorePromotion()

    // 5. Promotion completed: DB rows backfilled + every on-disk resource landed in
    //    userData with byte-exact content (the additive-moved step renamed them out of
    //    the staged archive subtree, not copied).
    read = readRestoreJournal()
    expect(read.kind).toBe('ok')
    if (read.kind === 'ok') expect(read.journal.state).toBe('completed')

    expect(readFileSync(application.getPath('feature.files.data', `${fileId}.${fileExt}`), 'utf8')).toBe(fileContent)
    expect(readFileSync(join(knowledgeRoot, kbId, 'doc.md'), 'utf8')).toBe('kb-doc')
    expect(readFileSync(join(skillsRoot, skillFolder, 'SKILL.md'), 'utf8')).toBe('skill-doc')

    const live = new Database(liveDbPath)
    try {
      const fileCount = live.prepare('SELECT count(*) AS c FROM file_entry WHERE id = ?').get(fileId) as { c: number }
      const kbCount = live.prepare('SELECT count(*) AS c FROM knowledge_base WHERE id = ?').get(kbId) as { c: number }
      const skillCount = live
        .prepare('SELECT count(*) AS c FROM agent_global_skill WHERE folder_name = ?')
        .get(skillFolder) as { c: number }
      expect(fileCount.c).toBe(1)
      expect(kbCount.c).toBe(1)
      expect(skillCount.c).toBe(1)
      expect(live.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      live.close()
    }
  })
})
