// Unit tests for ImportOrchestrator — the restore staging spine.
//
// The spine (snapshot → fingerprint → merge → migrate → seal → 2nd fingerprint →
// journal) is exercised end-to-end with no-op stubs for the not-yet-landed tracks
// (quiesce / merge / file-resource staging). Production wires those deps to throw,
// keeping restore fail-closed; here they are no-ops so the crash-safety orchestration
// is testable in isolation.
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import type { DbService } from '@main/data/db/DbService'
import { readAppliedChain } from '@main/data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArchiveContext } from '../admitArchive'
import {
  BackupCancelledError,
  RestoreFingerprintMismatchError,
  RestoreMergeNotImplementedError,
  RestoreQuiesceNotImplementedError
} from '../errors'
import { ImportOrchestrator, type ImportOrchestratorDeps } from '../ImportOrchestrator'
import type { BackupManifest } from '../manifest'

// Resolve the production drizzle migrations folder the same way the test DB harness
// does (relative to this file, not process.cwd()) so applyMigrations finds _journal.json.
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../migrations/sqlite-drizzle')

describe('ImportOrchestrator spine', () => {
  // Real file-backed DB with production migrations — gives the snapshot a __drizzle_migrations
  // table so readAppliedChain returns a non-empty chain (journal schema requires min 1).
  const dbh = setupTestDatabase()

  let tmpDir: string
  let stagingRoot: string
  let journalPath: string
  let liveDbPath: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-import-'))
    stagingRoot = join(tmpDir, 'restore-staging')
    journalPath = join(tmpDir, 'restore-journal.json')
    liveDbPath = dbh.sqlite.name
    // Route restore path keys at the temp tree so writeRestoreJournal lands here.
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
    vi.restoreAllMocks()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  /** Build deps with no-op stubs; tests override the unimplemented steps as needed. */
  const makeDeps = (overrides: Partial<ImportOrchestratorDeps> = {}): ImportOrchestratorDeps => ({
    dbService: {
      // Mirror DbService on the live test connection.
      checkpointTruncate: () => checkpointTruncateAssert(dbh.sqlite),
      createSnapshot: (workPath: string) => snapshotTo(dbh.sqlite, workPath)
    } as unknown as DbService,
    migrationsFolder: MIGRATIONS_FOLDER,
    liveDbPath,
    restoreStagingRoot: stagingRoot,
    userData: tmpDir,
    journalPath,
    // Archive admission is real (admitArchive.ts); spine tests use a no-op stub returning
    // a dummy ArchiveContext (importBackup awaits without binding — the return is discarded
    // until the merge consumer lands in spine-wiring, so the manifest shape is not read here).
    admitArchive: async (): Promise<ArchiveContext> => ({
      backupDbPath: join(stagingRoot, 'dummy-backup.sqlite'),
      manifest: {} as BackupManifest,
      domains: [],
      includeFiles: false,
      resourceMetadata: { fileIds: [], knowledgeBases: [], notePaths: [] }
    }),
    quiesceWriters: async () => {},
    mergeBackupIntoWork: async () => {},
    stageFileResources: async () => [],
    ...overrides
  })

  it('writes a staged journal with a valid fingerprint + chain on the happy path', async () => {
    const orch = new ImportOrchestrator(makeDeps())

    const result = await orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: 'rst-001' })

    expect(result.restoreId).toBe('rst-001')
    const read = readRestoreJournal()
    expect(read.kind).toBe('ok')
    if (read.kind !== 'ok') return
    expect(read.journal.state).toBe('staged')
    expect(read.journal.restoreId).toBe('rst-001')
    // fingerprint == a gate-equivalent re-checkpoint+rehash of the live DB (not just non-empty)
    checkpointTruncateAssert(dbh.sqlite)
    expect(read.journal.db.fingerprint).toBe(await hashDbFile(liveDbPath))
    // chain == readAppliedChain(work.sqlite) — the journal carries work's COMPLETE applied
    // sequence (the producer-side exact-equality seal guarantees it equals the bundled chain)
    const workRo = new Database(join(stagingRoot, 'rst-001', 'work.sqlite'), { readonly: true })
    try {
      expect(read.journal.db.chain).toEqual(readAppliedChain(workRo))
    } finally {
      workRo.close()
    }
    // promote/aside stored userData-relative. In production app.database.file lives
    // under userData so aside is a clean basename; here the test live DB is in a
    // sibling temp dir, so assert the exact path.relative the producer computes.
    expect(read.journal.db.promote).toBe(join('restore-staging', 'rst-001', 'work.sqlite'))
    expect(read.journal.db.aside).toBe(relative(tmpDir, `${liveDbPath}.aside-rst-001`))
    // work.sqlite sealed — no -wal/-shm sidecars (gate renames only the main file)
    expect(existsSync(join(stagingRoot, 'rst-001', 'work.sqlite'))).toBe(true)
    expect(existsSync(join(stagingRoot, 'rst-001', 'work.sqlite-wal'))).toBe(false)
    expect(existsSync(join(stagingRoot, 'rst-001', 'work.sqlite-shm'))).toBe(false)
  })

  it('aborts without a journal when a writer touches live during staging (2nd fingerprint mismatch)', async () => {
    const orch = new ImportOrchestrator(
      makeDeps({
        mergeBackupIntoWork: async () => {
          // Simulate a foreign writer touching the live DB mid-staging (after snapshot,
          // before the 2nd fingerprint). user_version lives in the DB header → flips the hash.
          dbh.sqlite.pragma('user_version = 12345')
        }
      })
    )

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: 'rst-002' })).rejects.toThrow(
      RestoreFingerprintMismatchError
    )

    // No journal written, staging subtree cleaned up (fail-closed).
    expect(readRestoreJournal().kind).toBe('none')
    expect(existsSync(join(stagingRoot, 'rst-002'))).toBe(false)
  })

  it('refuses to write a journal when the merge engine is not implemented (fail-closed)', async () => {
    const orch = new ImportOrchestrator(
      makeDeps({
        mergeBackupIntoWork: async () => {
          throw new RestoreMergeNotImplementedError()
        }
      })
    )

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: 'rst-003' })).rejects.toThrow(
      RestoreMergeNotImplementedError
    )

    expect(readRestoreJournal().kind).toBe('none')
    expect(existsSync(join(stagingRoot, 'rst-003'))).toBe(false)
  })

  it('refuses to snapshot when quiesce is not implemented (drain verdict precedes snapshot)', async () => {
    const orch = new ImportOrchestrator(
      makeDeps({
        quiesceWriters: async () => {
          throw new RestoreQuiesceNotImplementedError()
        }
      })
    )

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: 'rst-004' })).rejects.toThrow(
      RestoreQuiesceNotImplementedError
    )

    expect(readRestoreJournal().kind).toBe('none')
    // Quiesce throws before createSnapshot → no work.sqlite
    expect(existsSync(join(stagingRoot, 'rst-004', 'work.sqlite'))).toBe(false)
  })

  it('rejects an unsafe restoreId (path-traversal / non-basename)', async () => {
    const orch = new ImportOrchestrator(makeDeps())

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: '../escape' })).rejects.toThrow(
      /invalid restoreId/
    )
    await expect(orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: 'has space' })).rejects.toThrow(
      /invalid restoreId/
    )
  })

  it('refuses to start when the aside target already exists (unclean prior restore)', async () => {
    // A prior restore crashed leaving the aside file in place — the gate's rename would fail.
    const asideAbs = `${liveDbPath}.aside-rst-005`
    writeFileSync(asideAbs, 'stale')
    try {
      const orch = new ImportOrchestrator(makeDeps())
      await expect(orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: 'rst-005' })).rejects.toThrow(
        /aside target already exists/
      )
      expect(readRestoreJournal().kind).toBe('none')
    } finally {
      rmSync(asideAbs, { force: true })
    }
  })

  it('aborts with BackupCancelledError when the signal is already aborted', async () => {
    const orch = new ImportOrchestrator(makeDeps())
    const ac = new AbortController()
    ac.abort()
    await expect(
      orch.importBackup({ archivePath: '/tmp/fake.cbu', restoreId: 'rst-006', signal: ac.signal })
    ).rejects.toThrow(BackupCancelledError)
    expect(readRestoreJournal().kind).toBe('none')
  })

  it('aborts if the signal fires during the 2nd fingerprint (no journal written)', async () => {
    // The 2nd fingerprint is the last async before the synchronous journal write — an abort
    // during/after it must NOT proceed to write the journal + relaunch.
    const ac = new AbortController()
    const orch = new ImportOrchestrator(makeDeps())
    await expect(
      orch.importBackup({
        archivePath: '/tmp/fake.cbu',
        restoreId: 'rst-007',
        signal: ac.signal,
        onProgress: (u) => {
          if (u.phase === 'verify') ac.abort()
        }
      })
    ).rejects.toThrow(BackupCancelledError)
    expect(readRestoreJournal().kind).toBe('none')
  })
})
