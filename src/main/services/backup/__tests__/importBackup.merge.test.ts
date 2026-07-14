// Spine ↔ MergeEngine integration test (PR-5 step 7). Exercises the FULL importBackup
// spine — admission (real admitArchive unpacks a .cbu) → quiesce (no-op) → fingerprint →
// snapshot → merge (REAL MergeEngine: SKIP/INSERT + member cascade + junction phase + FTS
// rebuild + consistency check) → migrate → seal → stage (no-op) → 2nd fingerprint → staged
// journal — with a synthetic uuid-entity (TOPICS) archive.
//
// Validates the spine wiring: ArchiveContext.backupDbPath flows into MergeContext, the engine
// merges into the DETACHED work.sqlite (a VACUUM INTO copy of live — live is never written),
// and the spine writes a staged journal whose chain + fingerprint match. quiesce +
// file-resource staging stay no-op (their tracks are not landed); the merge engine is the
// real SKIP/INSERT slice (Stage 4).
//
// The synthetic .cbu is built with the production archiver (assembleArchive) from a
// better-sqlite3 online backup of the live test DB — same schema + migration chain, so the
// admission chain gate classifies it as equal (no migrate-forward) and integrity_check passes.

import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import type { DbService } from '@main/data/db/DbService'
import { readAppliedChain } from '@main/data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../admitArchive'
import { assembleArchive } from '../archive'
import { RestoreQuiesceNotImplementedError } from '../errors'
import { ImportOrchestrator, type ImportOrchestratorDeps } from '../ImportOrchestrator'
import { BACKUP_FORMAT_VERSION, type BackupManifest } from '../manifest'
import { MergeEngine } from '../merge'

// Production drizzle migrations folder — same resolution as ImportOrchestrator.test.ts so
// admitArchive's chain gate + applyMigrations find _journal.json.
const MIGRATIONS_FOLDER = resolve(dirname(fileURLToPath(import.meta.url)), '../../../../../migrations/sqlite-drizzle')

describe('importBackup spine ↔ MergeEngine integration', () => {
  // Live test DB = the snapshot base. work.sqlite is a VACUUM INTO copy of this, so the merge
  // engine writes the detached copy, never live. Production migrations + FTS5 triggers are
  // applied; beforeEach truncates user tables (schema + __drizzle_migrations are kept).
  const dbh = setupTestDatabase()
  // Real 14-domain registry; finalize is pure in-memory + cached.
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let stagingRoot: string
  let journalPath: string
  let liveDbPath: string
  let archivePath: string
  let backupDbPath: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-import-merge-'))
    stagingRoot = join(tmpDir, 'restore-staging')
    journalPath = join(tmpDir, 'restore-journal.json')
    liveDbPath = dbh.sqlite.name
    archivePath = join(tmpDir, 'backup.cbu')
    backupDbPath = join(tmpDir, 'backup.sqlite')
    // Clone the (truncated) live schema into a synthetic backup.sqlite — same schema +
    // migration chain, empty user tables, ready to seed. better-sqlite3 backup() is async
    // and copies the whole DB (tables + FTS virtual tables + triggers + __drizzle_migrations).
    await dbh.sqlite.backup(backupDbPath)
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

  /** Seed the synthetic backup.sqlite with raw rows in one tx (FK enforcement ON). */
  const seedBackup = (seed: (db: Database.Database) => void): void => {
    const db = new Database(backupDbPath)
    try {
      db.pragma('foreign_keys = ON')
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
    parentId: string | null
  ): void => {
    const now = Date.now()
    db.prepare(
      `INSERT INTO message (id, parent_id, topic_id, role, data, searchable_text, status, siblings_group_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '', 'success', 0, ?, ?)`
    ).run(id, parentId, topicId, role, JSON.stringify({ parts: [] }), now, now)
  }

  /**
   * Build a valid minimal manifest for a uuid-entity (TOPICS) lite archive. The admission
   * chain gate reads backup.sqlite's actual __drizzle_migrations chain (NOT schemaMigrationId),
   * so the manifest fields only need to satisfy the manifest zod schema.
   */
  const buildManifest = (): BackupManifest => ({
    backupFormatVersion: BACKUP_FORMAT_VERSION,
    createdAt: new Date().toISOString(),
    preset: 'lite',
    domains: ['TOPICS'],
    includeFiles: false,
    includeKnowledgeFiles: false,
    sensitiveData: { included: true, rotated: false },
    schemaMigrationId: '0',
    producerAppVersion: '0.0.0-test',
    files: { ids: [], total: 0, totalBytes: 0 },
    knowledge: { bases: [] },
    notes: { paths: [] }
  })

  /** Pack the synthetic backup.sqlite + manifest into a .cbu at archivePath. */
  const packArchive = async (): Promise<void> => {
    await assembleArchive(archivePath, { manifest: buildManifest(), dbCopyPath: backupDbPath })
  }

  /**
   * Build deps with REAL admitArchive + REAL MergeEngine. quiesce + file-resource staging
   * stay no-op (their tracks are not landed) — the spine still advances through merge to a
   * staged journal because the no-ops do not throw.
   */
  const makeDeps = (overrides: Partial<ImportOrchestratorDeps> = {}): ImportOrchestratorDeps => ({
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
    quiesceWriters: async () => {},
    mergeBackupIntoWork: (workSqlite, workDb, ctx) => {
      // D-model spine boundary: the engine receives the DETACHED work.sqlite handle, never
      // live. Assert handle identity so a wrong-wiring regression (passing the live handle)
      // fails loud — the work/live split is what makes "live untouched" meaningful here
      // (MergeEngine.test.ts runs the engine on live directly, so its untouched claim is vacuous).
      expect(workSqlite.name).not.toBe(liveDbPath)
      expect(workSqlite.name.endsWith('work.sqlite')).toBe(true)
      return new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, ctx)
    },
    stageFileResources: async () => [],
    ...overrides
  })

  /** Open the staged work.sqlite readonly for post-merge inspection. */
  const openWorkRo = (restoreId: string): Database.Database =>
    new Database(join(stagingRoot, restoreId, 'work.sqlite'), { readonly: true })

  it('SKIPs a backup root whose PK already exists in live (work keeps local row, no duplicate)', async () => {
    // Live holds topic 'tpc-skip' (the snapshot carries it into work.sqlite). Backup holds the
    // SAME pk with a different name — SKIP must retain the local row verbatim (no overwrite,
    // no duplicate). The spine must still write a staged journal.
    insertTopic(dbh.sqlite, 'tpc-skip', 'in-live')
    seedBackup((db) => insertTopic(db, 'tpc-skip', 'in-backup'))
    await packArchive()

    const result = await new ImportOrchestrator(makeDeps()).importBackup({
      archivePath,
      restoreId: 'rst-skip'
    })

    expect(result.restoreId).toBe('rst-skip')
    expect(readRestoreJournal().kind).toBe('ok')

    const workRo = openWorkRo('rst-skip')
    try {
      const rows = workRo.prepare(`SELECT name FROM topic WHERE id = 'tpc-skip'`).all() as { name: string }[]
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('in-live') // local survived; backup value NOT applied (SKIP)
      expect((workRo.prepare(`SELECT COUNT(*) AS c FROM topic`).get() as { c: number }).c).toBe(1)
    } finally {
      workRo.close()
    }

    // D-model invariant: live DB is never written during merge — the local row is unchanged
    // and no backup row landed in live (only work.sqlite holds the merged state).
    const liveRow = dbh.sqlite.prepare(`SELECT name FROM topic WHERE id = 'tpc-skip'`).get() as
      | { name: string }
      | undefined
    expect(liveRow?.name).toBe('in-live')
    expect((dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM topic`).get() as { c: number }).c).toBe(1)
  })

  it('INSERTs a new backup aggregate (root + include members cascade) into work.sqlite', async () => {
    // Live is empty for this topic. Backup holds topic + a root message + a child message —
    // INSERT must cascade both members (child resolves via the imported root message id, not
    // the topic id).
    seedBackup((db) => {
      insertTopic(db, 'tpc-new')
      insertMessage(db, 'msg-root', 'tpc-new', 'root', null)
      insertMessage(db, 'msg-child', 'tpc-new', 'assistant', 'msg-root')
    })
    await packArchive()

    await new ImportOrchestrator(makeDeps()).importBackup({
      archivePath,
      restoreId: 'rst-insert'
    })

    const workRo = openWorkRo('rst-insert')
    try {
      const topicCount = (workRo.prepare(`SELECT COUNT(*) AS c FROM topic WHERE id = 'tpc-new'`).get() as { c: number })
        .c
      expect(topicCount).toBe(1)
      const msgs = (
        workRo.prepare(`SELECT id FROM message WHERE topic_id = 'tpc-new' ORDER BY id`).all() as {
          id: string
        }[]
      ).map((r) => r.id)
      expect(msgs).toEqual(['msg-child', 'msg-root']) // root + child cascaded
      // The child's parent_id resolves to the imported root message id (nested FK preserved —
      // insertRow copies backup columns verbatim; guards against a regression rewriting or
      // dropping parent_id during the member cascade).
      const childParent = workRo.prepare(`SELECT parent_id AS p FROM message WHERE id = 'msg-child'`).get() as {
        p: string | null
      }
      expect(childParent.p).toBe('msg-root')
    } finally {
      workRo.close()
    }

    // D-model invariant: live DB untouched — the new aggregate landed in work.sqlite only.
    expect((dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM topic WHERE id = 'tpc-new'`).get() as { c: number }).c).toBe(
      0
    )
    expect(
      (dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM message WHERE topic_id = 'tpc-new'`).get() as { c: number }).c
    ).toBe(0)
  })

  it('leaves work.sqlite with empty foreign_key_check and ok integrity_check after merge', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-fk')
      insertMessage(db, 'msg-fk-root', 'tpc-fk', 'root', null)
    })
    await packArchive()

    await new ImportOrchestrator(makeDeps()).importBackup({
      archivePath,
      restoreId: 'rst-fk'
    })

    // The engine's in-tx runConsistencyCheck already asserts this; verify externally on the
    // sealed work.sqlite too (the gate's post-promotion check runs the same PRAGMAs).
    const workRo = openWorkRo('rst-fk')
    try {
      expect(workRo.pragma('foreign_key_check')).toEqual([])
      expect(workRo.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally {
      workRo.close()
    }
  })

  it('writes a staged journal whose chain + fingerprint match work/live (spine end-to-end)', async () => {
    seedBackup((db) => {
      insertTopic(db, 'tpc-journal')
      insertMessage(db, 'msg-journal', 'tpc-journal', 'root', null)
    })
    await packArchive()

    await new ImportOrchestrator(makeDeps()).importBackup({
      archivePath,
      restoreId: 'rst-journal'
    })

    const read = readRestoreJournal()
    expect(read.kind).toBe('ok')
    if (read.kind !== 'ok') return
    expect(read.journal.state).toBe('staged')
    expect(read.journal.restoreId).toBe('rst-journal')
    expect(read.journal.fileResources).toEqual([]) // staging track is no-op → nothing to promote

    // fingerprint == live DB (re-checkpoint + rehash). Merge wrote the DETACHED work.sqlite,
    // never live, so the live fingerprint is stable across the snapshot→verify window.
    checkpointTruncateAssert(dbh.sqlite)
    expect(read.journal.db.fingerprint).toBe(await hashDbFile(liveDbPath))

    // chain == work.sqlite's COMPLETE applied chain (the producer-side exact-equality seal
    // guarantees it equals the bundled chain; applyMigrations is a no-op on the already-current
    // snapshot). Work is sealed — no -wal/-shm sidecars (the gate renames only the main file).
    const workRo = openWorkRo('rst-journal')
    try {
      expect(read.journal.db.chain).toEqual(readAppliedChain(workRo))
      expect(existsSync(join(stagingRoot, 'rst-journal', 'work.sqlite'))).toBe(true)
      expect(existsSync(join(stagingRoot, 'rst-journal', 'work.sqlite-wal'))).toBe(false)
      expect(existsSync(join(stagingRoot, 'rst-journal', 'work.sqlite-shm'))).toBe(false)
    } finally {
      workRo.close()
    }
  })

  it('throws RestoreQuiesceNotImplementedError and writes no journal when quiesce is the throwing stub (fail-closed ordering)', async () => {
    // Step-7 acceptance (implement.md): re-confirm fail-closed ordering in THIS integration
    // fixture (real admitArchive + real MergeEngine dep). A throwing quiesce stub must abort
    // BEFORE merge runs — no journal, staging cleaned. ImportOrchestrator.test.ts covers the
    // stub-merge variant; this proves the real-spine ordering holds end-to-end.
    await packArchive()
    const mergeSpy = vi.fn()
    const orch = new ImportOrchestrator(
      makeDeps({
        quiesceWriters: async () => {
          throw new RestoreQuiesceNotImplementedError()
        },
        mergeBackupIntoWork: mergeSpy as unknown as ImportOrchestratorDeps['mergeBackupIntoWork']
      })
    )

    await expect(orch.importBackup({ archivePath, restoreId: 'rst-quiesce' })).rejects.toThrow(
      RestoreQuiesceNotImplementedError
    )

    // Quiesce threw before merge → merge never ran, no journal, staging cleaned (fail-closed).
    expect(mergeSpy).not.toHaveBeenCalled()
    expect(readRestoreJournal().kind).toBe('none')
    expect(existsSync(join(stagingRoot, 'rst-quiesce', 'work.sqlite'))).toBe(false)
  })
})
