// Unit tests for ImportOrchestrator — the restore staging spine.
//
// The spine (snapshot → fingerprint → merge → migrate → seal → 2nd fingerprint →
// journal) is exercised end-to-end with no-op stubs for the not-yet-landed tracks
// (quiesce / merge / file-resource staging). Production wires those deps to throw,
// keeping restore fail-closed; here they are no-ops so the crash-safety orchestration
// is testable in isolation.
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import type { DbService } from '@main/data/db/DbService'
import { readAppliedChain } from '@main/data/db/restore/appliedChain'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { hashDbFile } from '@main/data/db/restore/hashDbFile'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { setupTestDatabase } from '@test-helpers/db'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ArchiveContext } from '../admitArchive'
import {
  BackupCancelledError,
  RestoreFingerprintMismatchError,
  RestoreMergeNotImplementedError,
  RestoreQuiesceNotImplementedError
} from '../errors'
import {
  ASIDE_RETENTION_TBD,
  discoverAsideSlots,
  ImportOrchestrator,
  type ImportOrchestratorDeps
} from '../ImportOrchestrator'
import type { BackupManifest } from '../manifest'
import { planResources, type PlanRoots, type ResourcePlan } from '../resourcePlanning'

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
  const makePlanRoots = (): PlanRoots => ({
    files: join(tmpDir, 'Data', 'Files'),
    knowledge: join(tmpDir, 'Data', 'KnowledgeBase'),
    skills: join(tmpDir, 'Data', 'Skills'),
    notes: () => undefined
  })

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
    // a dummy ArchiveContext. Dummy manifest has no preset → planResources early-returns empty.
    admitArchive: async (): Promise<ArchiveContext> => ({
      backupDbPath: join(stagingRoot, 'dummy-backup.sqlite'),
      manifest: { degraded: { resources: [] } } as unknown as BackupManifest,
      domains: [],
      includeFiles: false,
      resourceMetadata: { fileIds: [], knowledgeBases: [], notePaths: [] }
    }),
    quiesceWriters: async () => {},
    mergeBackupIntoWork: async () => ({ degradedToSkips: [] }),
    planResources,
    planRoots: makePlanRoots(),
    ...overrides
  })

  it('writes a staged journal with a valid fingerprint + chain on the happy path', async () => {
    const orch = new ImportOrchestrator(makeDeps())

    const result = await orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-001' })

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
    expect(read.journal.summary).toEqual({ toRestore: [], toSkip: [], degradations: [] })
    // work.sqlite sealed — no -wal/-shm sidecars (gate renames only the main file)
    expect(existsSync(join(stagingRoot, 'rst-001', 'work.sqlite'))).toBe(true)
    expect(existsSync(join(stagingRoot, 'rst-001', 'work.sqlite-wal'))).toBe(false)
    expect(existsSync(join(stagingRoot, 'rst-001', 'work.sqlite-shm'))).toBe(false)
  })

  it('passes the exact resource plan to MergeEngine', async () => {
    const plan: ResourcePlan = {
      stagedFileEntryIds: new Set(),
      skippedFileEntryIds: new Set(),
      skippedKnowledgeBaseIds: new Set(),
      skippedSkillFolderNames: new Set(),
      resources: [],
      noteAdditions: new Map([['note.md', join(tmpDir, 'Data', 'Notes')]]),
      toRestore: [],
      skips: []
    }
    const mergeBackupIntoWork = vi.fn(async () => ({ degradedToSkips: [] }))
    const orch = new ImportOrchestrator(
      makeDeps({
        planResources: () => plan,
        mergeBackupIntoWork
      })
    )

    await orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-plan' })

    expect(mergeBackupIntoWork).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ resourcePlan: plan })
    )
  })

  it('persists merge + export degradations in journal.summary and returns the same object', async () => {
    // Degradations describe loss the restore ALREADY accepted; the confirmation UI only runs
    // after the relaunch, so a log line is not enough — they must survive in the journal.
    const orch = new ImportOrchestrator(
      makeDeps({
        admitArchive: async (): Promise<ArchiveContext> => ({
          backupDbPath: join(stagingRoot, 'dummy-backup.sqlite'),
          manifest: {
            degraded: {
              resources: [
                { kind: 'skill-dir-missing', folderName: 'gone-skill', contentHash: 'h1' },
                { kind: 'skill-dir-missing', folderName: 'gone-skill-2', contentHash: 'h2' }
              ]
            }
          } as unknown as BackupManifest,
          domains: [],
          includeFiles: false,
          resourceMetadata: { fileIds: [], knowledgeBases: [], notePaths: [] }
        }),
        mergeBackupIntoWork: async () => ({
          degradedToSkips: [
            { kind: 'row_pruned', table: 'chat_message_file_ref', count: 2, reason: 'target missing' },
            { kind: 'attachment_unavailable', table: 'message', count: 5, reason: 'blob not staged' },
            // The engine's consumer-neutral 'remote_overwrote_local' must map to backup's published
            // 'backup_overwrote_local' (the IPC + i18n key). This is the one kind whose name differs
            // across the two vocabularies — assert the mapping lands inside the zod enum.
            { kind: 'remote_overwrote_local', table: 'app_state', count: 1, reason: 'backup-wins replaced local' }
          ]
        })
      })
    )

    const result = await orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-degr' })

    const expected = [
      { kind: 'row_pruned', scope: 'chat_message_file_ref', count: 2, detail: 'target missing' },
      { kind: 'attachment_unavailable', scope: 'message', count: 5, detail: 'blob not staged' },
      // Engine 'remote_overwrote_local' → published 'backup_overwrote_local' (the only renamed kind).
      { kind: 'backup_overwrote_local', scope: 'app_state', count: 1, detail: 'backup-wins replaced local' },
      // Export-side omissions fold into one line per cause, with the folder names in `detail`.
      {
        kind: 'resource_content_missing',
        scope: 'agent_global_skill',
        count: 2,
        detail: 'skill-dir-missing: gone-skill, gone-skill-2'
      }
    ]
    expect(result.summary.degradations).toEqual(expected)
    const read = readRestoreJournal()
    if (read.kind !== 'ok') throw new Error('expected a staged journal')
    expect(read.journal.summary?.degradations).toEqual(expected)
  })

  it('aborts without a journal when a writer touches live during staging (2nd fingerprint mismatch)', async () => {
    const orch = new ImportOrchestrator(
      makeDeps({
        mergeBackupIntoWork: async () => {
          // Simulate a foreign writer touching the live DB mid-staging (after snapshot,
          // before the 2nd fingerprint). user_version lives in the DB header → flips the hash.
          dbh.sqlite.pragma('user_version = 12345')
          return { degradedToSkips: [] }
        }
      })
    )

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-002' })).rejects.toThrow(
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

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-003' })).rejects.toThrow(
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

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-004' })).rejects.toThrow(
      RestoreQuiesceNotImplementedError
    )

    expect(readRestoreJournal().kind).toBe('none')
    // Quiesce throws before createSnapshot → no work.sqlite
    expect(existsSync(join(stagingRoot, 'rst-004', 'work.sqlite'))).toBe(false)
  })

  it('rejects an unsafe restoreId (path-traversal / non-basename)', async () => {
    const orch = new ImportOrchestrator(makeDeps())

    await expect(orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: '../escape' })).rejects.toThrow(
      /invalid restoreId/
    )
    await expect(orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'has space' })).rejects.toThrow(
      /invalid restoreId/
    )
  })

  it('refuses to start when the aside target already exists (unclean prior restore)', async () => {
    // A prior restore crashed leaving the aside file in place — the gate's rename would fail.
    const asideAbs = `${liveDbPath}.aside-rst-005`
    writeFileSync(asideAbs, 'stale')
    try {
      const orch = new ImportOrchestrator(makeDeps())
      await expect(orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-005' })).rejects.toThrow(
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
      orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-006', signal: ac.signal })
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
        archivePath: '/tmp/fake.cherrybackup',
        restoreId: 'rst-007',
        signal: ac.signal,
        onProgress: (u) => {
          if (u.phase === 'verify') ac.abort()
        }
      })
    ).rejects.toThrow(BackupCancelledError)
    expect(readRestoreJournal().kind).toBe('none')
  })

  it('D8 统计告知版: logs (does not block) MCP dxtPath package dirs missing locally', async () => {
    // A schema-only restore re-creates mcp_server rows but NOT the DXT package dir its dxtPath
    // points at. The post-merge scan must surface that gap as a NON-BLOCKING warn and must NOT
    // touch summary.degradations (user-visible disclosure is owner TBD) or fail the restore.
    const missingPath = join(tmpdir(), 'cs-mcp-package-absent-' + Date.now())
    const presentDir = mkdtempSync(join(tmpdir(), 'cs-mcp-package-present-'))
    // mergeBackupIntoWork receives workSqlite (the post-snapshot detached DB) — simulate a real
    // merge importing three MCP servers: one missing package, one present, one non-DXT (no path).
    // created_at/updated_at/is_active are NOT NULL in the production schema.
    const mergeBackupIntoWork = vi.fn(async (workSqlite: Database.Database) => {
      const insert = workSqlite.prepare(
        'INSERT INTO mcp_server (id, name, dxt_path, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)'
      )
      insert.run('srv-1', 'missing-dxt', missingPath)
      insert.run('srv-2', 'present-dxt', presentDir)
      insert.run('srv-3', 'plain-stdio', null)
      return { degradedToSkips: [] }
    })
    const orch = new ImportOrchestrator(
      makeDeps({
        admitArchive: async (): Promise<ArchiveContext> => ({
          backupDbPath: join(stagingRoot, 'dummy-backup.sqlite'),
          manifest: { degraded: { resources: [] } } as unknown as BackupManifest,
          domains: ['MCP_SERVERS'],
          includeFiles: false,
          resourceMetadata: { fileIds: [], knowledgeBases: [], notePaths: [] }
        }),
        mergeBackupIntoWork
      })
    )
    mockMainLoggerService.warn.mockClear()

    const result = await orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-d8' })

    // Restore completed — merge was NOT blocked by the missing package dir.
    expect(result.restoreId).toBe('rst-d8')
    expect(readRestoreJournal().kind).toBe('ok')
    // The summary stays untouched: no new degradation kind, no MCP entry.
    expect(result.summary.degradations).toEqual([])

    // The gap is observable via exactly one warn carrying the count + server-name scope.
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'restore: MCP server package dirs missing on local filesystem (non-blocking)',
      expect.objectContaining({ count: 1, scopes: ['missing-dxt'] })
    )
  })

  it('D8 统计告知版: stays silent when MCP_SERVERS is not in the restore domains', async () => {
    // An unrelated restore (no MCP_SERVERS domain) must not log the MCP scan — the scan is
    // scoped to restores that actually touch MCP servers.
    const missingPath = join(tmpdir(), 'cs-mcp-absent-nodomain-' + Date.now())
    const mergeBackupIntoWork = vi.fn(async (workSqlite: Database.Database) => {
      workSqlite
        .prepare(
          'INSERT INTO mcp_server (id, name, dxt_path, is_active, created_at, updated_at) VALUES (?, ?, ?, 0, 0, 0)'
        )
        .run('srv-x', 'ghost', missingPath)
      return { degradedToSkips: [] }
    })
    const orch = new ImportOrchestrator(
      makeDeps({
        admitArchive: async (): Promise<ArchiveContext> => ({
          backupDbPath: join(stagingRoot, 'dummy-backup.sqlite'),
          manifest: { degraded: { resources: [] } } as unknown as BackupManifest,
          domains: ['PREFERENCES'],
          includeFiles: false,
          resourceMetadata: { fileIds: [], knowledgeBases: [], notePaths: [] }
        }),
        mergeBackupIntoWork
      })
    )
    mockMainLoggerService.warn.mockClear()

    await orch.importBackup({ archivePath: '/tmp/fake.cherrybackup', restoreId: 'rst-d8-silent' })

    expect(mockMainLoggerService.warn).not.toHaveBeenCalledWith(
      'restore: MCP server package dirs missing on local filesystem (non-blocking)',
      expect.anything()
    )
  })

  it('D6: discoverAsideSlots enumerates aside slots + retention config is owner-TBD (null)', () => {
    // Plant two aside files next to the live DB (as the promotion gate would create on rename).
    // The naming convention is `<liveDbPath>.aside-<restoreId>`.
    writeFileSync(`${liveDbPath}.aside-rst-old`, 'old')
    writeFileSync(`${liveDbPath}.aside-rst-newer`, 'newer')

    const slots = discoverAsideSlots(liveDbPath)
    expect(slots).toHaveLength(2)
    // Each slot carries the restoreId parsed from the suffix + an absolute path + mtime.
    expect(slots.map((s) => s.restoreId).sort()).toEqual(['rst-newer', 'rst-old'])
    expect(slots.every((s) => s.asidePath.startsWith(dirname(liveDbPath)))).toBe(true)
    expect(slots.every((s) => Number.isFinite(s.createdAtMs))).toBe(true)

    // The retention config is owner-TBD: both bounds are null (no invented numbers).
    expect(ASIDE_RETENTION_TBD.maxSlots).toBeNull()
    expect(ASIDE_RETENTION_TBD.maxAgeMs).toBeNull()
  })

  it('D6: discoverAsideSlots ignores unrelated files and tolerates a missing directory', () => {
    // Clean any aside files left by the prior D6 test in this shared live-DB directory.
    for (const name of readdirSync(dirname(liveDbPath))) {
      if (name.startsWith(`${basename(liveDbPath)}.aside-`)) {
        rmSync(join(dirname(liveDbPath), name), { force: true })
      }
    }
    // Only `.aside-` prefixed files count; siblings like the live DB or -wal are ignored.
    writeFileSync(`${liveDbPath}.aside-rst-keep`, 'keep')
    writeFileSync(`${liveDbPath}-wal`, 'not-an-aside')
    writeFileSync(join(dirname(liveDbPath), 'random-file'), 'noise')

    const slots = discoverAsideSlots(liveDbPath)
    expect(slots).toHaveLength(1)
    expect(slots[0].restoreId).toBe('rst-keep')

    // A path whose directory does not exist yields an empty list (sweeper stays a no-op).
    expect(discoverAsideSlots(join(tmpDir, 'no-such-dir', 'missing.sqlite'))).toEqual([])
  })
})
