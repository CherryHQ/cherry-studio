import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { DbService } from '@main/data/db/DbService'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { runRestorePromotion } from '@main/data/db/restore/restorePromotion'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import { resolveMigrationsPath } from '@test-helpers/db/internal/migrationsPath'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../admitArchive'
import { assembleArchive } from '../archive'
import { finalizeFileResources, stageFileResources } from '../fileResourceStaging'
import { ImportOrchestrator, type ImportOrchestratorDeps } from '../ImportOrchestrator'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../manifest'
import { MergeEngine } from '../merge'

const pathState = vi.hoisted(() => ({
  userData: '',
  liveDbPath: '',
  journalPath: '',
  stagingRoot: '',
  migrationsFolder: ''
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mockModule = mockApplicationFactory()
  return {
    ...mockModule,
    application: {
      ...mockModule.application,
      getPath: vi.fn((key: string, filename?: string) => {
        const paths: Readonly<Record<string, string>> = {
          'app.userdata': pathState.userData,
          'app.database.file': pathState.liveDbPath,
          'app.database.migrations': pathState.migrationsFolder,
          'feature.backup.restore.file': pathState.journalPath,
          'feature.backup.restore.staging': pathState.stagingRoot
        }
        const base = paths[key]
        if (!base) throw new Error(`Unexpected path key in importBackup promotion test: ${key}`)
        return filename ? join(base, filename) : base
      })
    }
  }
})

const RESTORE_ID = 'rst-promotion'
const FILE_ENTRY_ID = 'fe-promoted'
const TOPIC_ID = 'tpc-promoted'
const MESSAGE_ID = 'msg-promoted'
const FILE_REF_ID = 'ref-promoted'
const BLOB_CONTENT = `blob-${FILE_ENTRY_ID}`

describe.sequential('importBackup spine and restore promotion integration', () => {
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let stagingRoot: string
  let journalPath: string
  let liveDbPath: string
  let liveFileRoot: string
  let archivePath: string
  let backupDbPath: string
  let archiveFilesDir: string

  beforeEach(async () => {
    liveDbPath = dbh.sqlite.name
    tmpDir = dirname(liveDbPath)
    stagingRoot = join(tmpDir, 'restore-staging')
    journalPath = join(tmpDir, 'restore-journal.json')
    liveFileRoot = join(tmpDir, 'Data', 'Files')
    archivePath = join(tmpDir, 'backup.cbu')
    backupDbPath = join(tmpDir, 'backup.sqlite')
    archiveFilesDir = join(tmpDir, 'archive-files')

    cleanupArtifacts()
    pathState.userData = tmpDir
    pathState.liveDbPath = liveDbPath
    pathState.journalPath = journalPath
    pathState.stagingRoot = stagingRoot
    pathState.migrationsFolder = resolveMigrationsPath()

    // Clone the migrated live schema into the archive DB before seeding backup-only rows.
    await dbh.sqlite.backup(backupDbPath)
  })

  afterEach(() => {
    cleanupArtifacts()
  })

  /** Remove only artifacts owned by this fixture; setupTestDatabase owns the temp directory. */
  function cleanupArtifacts(): void {
    for (const target of [
      stagingRoot,
      journalPath,
      `${journalPath}.tmp`,
      archivePath,
      backupDbPath,
      archiveFilesDir,
      join(tmpDir || '', 'Data'),
      liveDbPath ? `${liveDbPath}.aside-${RESTORE_ID}` : ''
    ]) {
      if (target) rmSync(target, { recursive: true, force: true })
    }
  }

  /** Insert all backup rows needed to prove the promoted DB and blob agree. */
  function seedBackup(): void {
    const backup = new Database(backupDbPath)
    try {
      backup.pragma('foreign_keys = ON')
      backup.transaction(() => {
        const now = Date.now()
        backup
          .prepare(
            `INSERT INTO file_entry (id, origin, name, external_path, created_at, updated_at)
             VALUES (?, 'external', ?, ?, ?, ?)`
          )
          .run(FILE_ENTRY_ID, FILE_ENTRY_ID, `/archive/${FILE_ENTRY_ID}`, now, now)
        backup
          .prepare(
            `INSERT INTO topic (id, name, is_name_manually_edited, order_key, created_at, updated_at)
             VALUES (?, ?, 0, ?, ?, ?)`
          )
          .run(TOPIC_ID, TOPIC_ID, `order-${TOPIC_ID}`, now, now)
        backup
          .prepare(
            `INSERT INTO message (id, parent_id, topic_id, role, data, searchable_text, status, siblings_group_id, created_at, updated_at)
             VALUES (?, NULL, ?, 'root', ?, '', 'success', 0, ?, ?)`
          )
          .run(MESSAGE_ID, TOPIC_ID, JSON.stringify({ parts: [] }), now, now)
        backup
          .prepare(
            `INSERT INTO chat_message_file_ref (id, source_id, file_entry_id, role, created_at, updated_at)
             VALUES (?, ?, ?, 'attachment', ?, ?)`
          )
          .run(FILE_REF_ID, MESSAGE_ID, FILE_ENTRY_ID, now, now)
      })()
    } finally {
      backup.close()
    }
  }

  /** Assemble a full archive with the production files/<id> payload layout. */
  async function packFileArchive(): Promise<void> {
    mkdirSync(archiveFilesDir, { recursive: true })
    writeFileSync(join(archiveFilesDir, FILE_ENTRY_ID), BLOB_CONTENT)
    const manifest: BackupManifest = {
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      preset: 'full',
      domains: ['FILE_STORAGE', 'TOPICS'],
      includeFiles: true,
      includeKnowledgeFiles: false,
      sensitiveData: { included: true, rotated: false },
      schemaMigrationId: '0',
      producerAppVersion: '0.0.0-test',
      files: { ids: [FILE_ENTRY_ID], total: 1, totalBytes: Buffer.byteLength(BLOB_CONTENT) },
      knowledge: { bases: [] },
      notes: { paths: [] }
    }
    await assembleArchive(archivePath, { manifest, dbCopyPath: backupDbPath, filesDir: archiveFilesDir })
  }

  /** Build the real spine dependencies while bypassing only the fail-closed quiesce boundary. */
  function makeDeps(): ImportOrchestratorDeps {
    return {
      dbService: {
        checkpointTruncate: () => checkpointTruncateAssert(dbh.sqlite),
        createSnapshot: (workPath: string) => snapshotTo(dbh.sqlite, workPath)
      } as unknown as DbService,
      migrationsFolder: resolveMigrationsPath(),
      liveDbPath,
      restoreStagingRoot: stagingRoot,
      liveFileRoot,
      userData: tmpDir,
      journalPath,
      admitArchive,
      quiesceWriters: async () => {},
      mergeBackupIntoWork: (workSqlite, workDb, context) =>
        new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, context),
      stageFileResources,
      finalizeFileResources: async (options) => finalizeFileResources(options)
    }
  }

  /** Build and stage one complete restore candidate through the real import spine. */
  async function stageRestore(): Promise<void> {
    seedBackup()
    await packFileArchive()
    await new ImportOrchestrator(makeDeps()).importBackup({ archivePath, restoreId: RESTORE_ID })

    const journal = readRestoreJournal()
    expect(journal.kind).toBe('ok')
    if (journal.kind !== 'ok') throw new Error('Expected importBackup to write a staged restore journal')
    expect(journal.journal.state).toBe('staged')
    expect(journal.journal.fileResources).toEqual([
      {
        kind: 'blob-add',
        stagingPath: join('restore-staging', RESTORE_ID, 'resources', 'files', FILE_ENTRY_ID),
        livePath: join('Data', 'Files', FILE_ENTRY_ID)
      }
    ])
  }

  it('expires without promotion when the live fingerprint changes after staging', async () => {
    dbh.sqlite
      .prepare(
        `INSERT INTO topic (id, name, is_name_manually_edited, order_key, created_at, updated_at)
         VALUES ('tpc-live-old', 'live-old', 0, 'live-old', 1, 1)`
      )
      .run()
    await stageRestore()

    // Simulate a write-gate leak after importBackup captured its second fingerprint.
    dbh.sqlite
      .prepare(
        `INSERT INTO topic (id, name, is_name_manually_edited, order_key, created_at, updated_at)
         VALUES ('tpc-live-drift', 'live-drift', 0, 'live-drift', 2, 2)`
      )
      .run()

    await runRestorePromotion()

    const journal = readRestoreJournal()
    expect(journal.kind).toBe('ok')
    if (journal.kind !== 'ok') throw new Error('Expected promotion to retain an expired journal')
    expect(journal.journal.state).toBe('expired')
    expect(dbh.sqlite.prepare(`SELECT id FROM topic WHERE id = 'tpc-live-old'`).get()).toBeDefined()
    expect(dbh.sqlite.prepare(`SELECT id FROM topic WHERE id = 'tpc-live-drift'`).get()).toBeDefined()
    expect(dbh.sqlite.prepare('SELECT id FROM file_entry WHERE id = ?').get(FILE_ENTRY_ID)).toBeUndefined()
    expect(existsSync(join(liveFileRoot, FILE_ENTRY_ID))).toBe(false)
    expect(existsSync(join(stagingRoot, RESTORE_ID))).toBe(false)
  })

  it('promotes the staged database and blob-add file end to end', async () => {
    await stageRestore()

    // Promotion runs preboot with no live DbService connection holding the database open.
    dbh.sqlite.close()
    await runRestorePromotion()

    const journal = readRestoreJournal()
    expect(journal.kind).toBe('ok')
    if (journal.kind !== 'ok') throw new Error('Expected promotion to retain a completed journal')
    expect(journal.journal.state).toBe('completed')

    const promoted = new Database(liveDbPath, { readonly: true, fileMustExist: true })
    try {
      const fileEntry = promoted
        .prepare('SELECT origin, external_path, size FROM file_entry WHERE id = ?')
        .get(FILE_ENTRY_ID) as { origin: string; external_path: string | null; size: number } | undefined
      expect(fileEntry).toEqual({
        origin: 'internal',
        external_path: null,
        size: Buffer.byteLength(BLOB_CONTENT)
      })
      expect(
        promoted.prepare('SELECT source_id, file_entry_id FROM chat_message_file_ref WHERE id = ?').get(FILE_REF_ID)
      ).toEqual({ source_id: MESSAGE_ID, file_entry_id: FILE_ENTRY_ID })
      expect(promoted.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      promoted.close()
    }

    expect(readFileSync(join(liveFileRoot, FILE_ENTRY_ID), 'utf8')).toBe(BLOB_CONTENT)
    expect(existsSync(join(stagingRoot, RESTORE_ID))).toBe(false)
  })
})
