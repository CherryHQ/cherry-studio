/**
 * e2e-restore full-preset resource fixtures — workstream B3 (full-restore-plan §10.7).
 *
 * Runnable:
 * - fixture integrity: a well-formed full archive round-trips through admitArchive
 *   with every resource tree extracted; corruption fixtures produce exactly the
 *   manifest↔archive divergence planning must detect
 * - the merge side of the frozen ResourcePlan contract: skippedFileEntryIds prunes
 *   file_entry aggregates, stagedFileEntryIds suppresses attachment disclosure
 *
 * A1/A2 landed; spine e2e below. Planning conflict/ARCHIVE_CORRUPT remain
 * unit-covered in resourcePlanning.test.ts; restorePromotion clean-expire is
 * follow-up beyond A2.
 */
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { setBackupInProgress } from '@main/data/db/backup/quiesceGate'
import type { DbService } from '@main/data/db/DbService'
import { checkpointTruncateAssert } from '@main/data/db/restore/checkpoint'
import { readRestoreJournal } from '@main/data/db/restore/restoreJournal'
import { snapshotTo } from '@main/data/db/restore/snapshot'
import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { BackupArchiveCorruptError } from '@main/services/backup/errors'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { admitArchive } from '../../admitArchive'
import { ImportOrchestrator, type ImportOrchestratorDeps } from '../../ImportOrchestrator'
import { MergeEngine } from '../../merge/MergeEngine'
import { planResources } from '../../resourcePlanning'
import { buildFullArchive } from './fullArchiveFixture'

const MIGRATIONS_FOLDER = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../../migrations/sqlite-drizzle'
)

describe('e2e-restore full resource fixtures (B3)', () => {
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let workDir: string
  let stagingRoot: string
  let journalPath: string
  let liveDbPath: string
  let archivePath: string
  let backupDbPath: string
  let filesRoot: string

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'cs-e2e-restore-full-res-'))
    workDir = join(tmpDir, 'workdir')
    stagingRoot = join(tmpDir, 'restore-staging')
    journalPath = join(tmpDir, 'restore-journal.json')
    liveDbPath = dbh.sqlite.name
    archivePath = join(tmpDir, 'backup.cherrybackup')
    backupDbPath = join(tmpDir, 'backup.sqlite')
    filesRoot = join(tmpDir, 'Data', 'Files')
    mkdirSync(filesRoot, { recursive: true })
    mkdirSync(join(tmpDir, 'Data', 'KnowledgeBase'), { recursive: true })
    mkdirSync(join(tmpDir, 'Data', 'Skills'), { recursive: true })
    await dbh.sqlite.backup(backupDbPath)
    setBackupInProgress(false)

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
        case 'feature.files.data':
          return filename ? join(filesRoot, filename) : filesRoot
        default:
          return filename ? join(tmpDir, key, filename) : join(tmpDir, key)
      }
    })
  })

  afterEach(() => {
    setBackupInProgress(false)
    vi.restoreAllMocks()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  /** Insert a row auto-filling NOT NULL/no-default columns (mirrors restore.full.test.ts). */
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

  const seedBackup = (seed: (db: Database.Database) => void): void => {
    const db = new Database(backupDbPath)
    try {
      db.pragma('foreign_keys = ON')
      db.transaction(seed)(db)
    } finally {
      db.close()
    }
  }

  it('admits a well-formed full archive and extracts every resource tree', async () => {
    seedBackup((db) => {
      seedRow(db, 'file_entry', { id: 'fe-1', origin: 'internal', name: 'pic.png', size: 14 })
    })
    await buildFullArchive({
      stageRoot: tmpDir,
      archivePath,
      dbCopyPath: backupDbPath,
      files: [{ id: 'fe-1', content: 'blob-content-1' }],
      knowledgeBases: [{ baseId: 'kb-1', files: { 'doc.md': 'kb doc' } }],
      skills: [{ folderName: 'my-skill', files: { 'SKILL.md': 'skill doc' } }],
      notes: [{ relPath: 'folder/note.md', content: 'note body' }]
    })

    const ctx = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    expect(ctx.manifest.preset).toBe('full')
    expect(ctx.includeFiles).toBe(true)
    expect(ctx.resourceMetadata.fileIds).toEqual(['fe-1'])
    expect(ctx.resourceMetadata.knowledgeBases).toEqual(['kb-1'])
    expect(ctx.resourceMetadata.notePaths).toEqual(['folder/note.md'])
    expect(ctx.manifest.skills.folders.map((f) => f.folderName)).toEqual(['my-skill'])

    expect(statSync(join(workDir, 'files', 'fe-1')).isFile()).toBe(true)
    expect(await readFile(join(workDir, 'files', 'fe-1'), 'utf8')).toBe('blob-content-1')
    expect(statSync(join(workDir, 'knowledge', 'kb-1')).isDirectory()).toBe(true)
    expect(await readFile(join(workDir, 'knowledge', 'kb-1', 'doc.md'), 'utf8')).toBe('kb doc')
    expect(statSync(join(workDir, 'skills', 'my-skill')).isDirectory()).toBe(true)
    expect(await readFile(join(workDir, 'notes', 'folder', 'note.md'), 'utf8')).toBe('note body')
    // The planning input contract: backup.sqlite holds the internal file_entry row.
    const backupDb = new Database(ctx.backupDbPath, { readonly: true })
    try {
      expect(backupDb.prepare(`SELECT origin FROM file_entry WHERE id='fe-1'`).get()).toMatchObject({
        origin: 'internal'
      })
    } finally {
      backupDb.close()
    }
  })

  it('corruption fixtures produce exactly the manifest↔archive divergence planning must detect', async () => {
    // external-origin row: manifest claims it as a staged file id → planning CORRUPT.
    seedBackup((db) => {
      seedRow(db, 'file_entry', { id: 'fe-ext', origin: 'external', name: 'ext', external_path: '/tmp/ext' })
    })
    await buildFullArchive({
      stageRoot: tmpDir,
      archivePath,
      dbCopyPath: backupDbPath,
      files: [
        { id: 'fe-gone', corrupt: 'missing-blob' },
        { id: 'fe-dir', corrupt: 'dir-instead-of-file' },
        { id: 'fe-ext', content: 'ext-blob' }
      ],
      knowledgeBases: [{ baseId: 'kb-flat', corrupt: 'file-instead-of-dir' }],
      notes: [{ relPath: 'gone.md', corrupt: 'missing-body' }]
    })

    // Admission is a format gate, not a resource cross-check — §8/§9 detection is
    // planning's job. The corrupt archive must ADMIT so planning can see the divergence.
    const ctx = await admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)

    // Manifest claims everything…
    expect(ctx.resourceMetadata.fileIds).toEqual(['fe-gone', 'fe-dir', 'fe-ext'])
    expect(ctx.resourceMetadata.notePaths).toEqual(['gone.md'])
    // …but the unpacked tree diverges per corruption knob:
    expect(existsSync(join(workDir, 'files', 'fe-gone'))).toBe(false) // missing blob
    expect(statSync(join(workDir, 'files', 'fe-dir')).isDirectory()).toBe(true) // wrong type
    expect(statSync(join(workDir, 'knowledge', 'kb-flat')).isFile()).toBe(true) // wrong type
    expect(existsSync(join(workDir, 'notes', 'gone.md'))).toBe(false) // missing note body
    // …and fe-ext's row is external while the manifest lists it as staged:
    const backupDb = new Database(ctx.backupDbPath, { readonly: true })
    try {
      expect(backupDb.prepare(`SELECT origin FROM file_entry WHERE id='fe-ext'`).get()).toMatchObject({
        origin: 'external'
      })
    } finally {
      backupDb.close()
    }
  })

  it('forged full manifest (includeFiles=false with files.ids) is rejected by §9 invariants (A2 assertFull)', async () => {
    await buildFullArchive({
      stageRoot: tmpDir,
      archivePath,
      dbCopyPath: backupDbPath,
      files: [{ id: 'fe-1', content: 'x' }],
      manifestOverrides: { includeFiles: false }
    })

    // §9 invariant (A2 assertFullManifestInvariants): full + includeFiles=false while
    // files.ids is non-empty is corrupt — resources would stage while the DB side
    // behaves lite. Rejected at admission.
    await expect(admitArchive(archivePath, workDir, MIGRATIONS_FOLDER)).rejects.toThrow(BackupArchiveCorruptError)
  })

  it('merge consumes plan.skippedFileEntryIds: the conflicted file_entry row is not imported', async () => {
    // fe-skip has NO local row (planning skipped it on a disk-exists conflict) — without
    // the skip set the merge would import it; the set alone must prune the aggregate.
    seedBackup((db) => {
      seedRow(db, 'file_entry', { id: 'fe-skip', origin: 'internal', name: 'skip.png', size: 1 })
      seedRow(db, 'file_entry', { id: 'fe-fresh', origin: 'internal', name: 'fresh.png', size: 1 })
    })

    const workPath = join(tmpDir, 'work.sqlite')
    snapshotTo(dbh.sqlite, workPath)
    const workSqlite = new Database(workPath)
    try {
      const workDb = drizzle({ client: workSqlite, casing: 'snake_case' })
      await new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, {
        backupDbPath,
        domains: ['FILE_STORAGE'],
        skippedFileEntryIds: new Set(['fe-skip']),
        stagedFileEntryIds: new Set(['fe-fresh'])
      })
      const ids = (workSqlite.prepare(`SELECT id FROM file_entry`).all() as { id: string }[]).map((r) => r.id)
      expect(ids).toContain('fe-fresh')
      expect(ids).not.toContain('fe-skip')
    } finally {
      workSqlite.close()
    }
  })

  it('merge consumes plan.stagedFileEntryIds: staged attachment refs are not disclosed', async () => {
    seedBackup((db) => {
      seedRow(db, 'file_entry', { id: 'fe-att', origin: 'internal', name: 'att.png', size: 1 })
      seedRow(db, 'topic', { id: 'tpc-att', name: 'chat', order_key: 'o-t1' })
      seedRow(db, 'message', {
        id: 'msg-att',
        topic_id: 'tpc-att',
        role: 'root',
        data: JSON.stringify({ parts: [{ type: 'file', fileEntryId: 'fe-att' }] }),
        status: 'success',
        siblings_group_id: 0
      })
    })

    const workPath = join(tmpDir, 'work.sqlite')
    snapshotTo(dbh.sqlite, workPath)
    const workSqlite = new Database(workPath)
    try {
      const workDb = drizzle({ client: workSqlite, casing: 'snake_case' })
      const result = await new MergeEngine(registry).mergeBackupIntoWork(workSqlite, workDb, {
        backupDbPath,
        domains: ['FILE_STORAGE', 'TOPICS'],
        skippedFileEntryIds: new Set(),
        stagedFileEntryIds: new Set(['fe-att']) // planning staged the blob → no disclosure
      })
      expect(result.degradedToSkips.some((d) => d.table === 'message' && d.reason.includes('not staged'))).toBe(false)
      expect(workSqlite.prepare(`SELECT id FROM message WHERE id='msg-att'`).get()).toBeDefined()
    } finally {
      workSqlite.close()
    }
  })

  // ── A1/A2-dependent scenarios ──
  // Planning conflict / ARCHIVE_CORRUPT: unit-covered in resourcePlanning.test.ts
  it.todo(
    'planning: conflict (local DB row OR disk exists) all-skips per class with reasons — unit-covered in resourcePlanning.test.ts'
  )
  it.todo(
    'planning: manifest-claimed blob missing / wrong type / external id / symlink → ARCHIVE_CORRUPT — unit-covered in resourcePlanning.test.ts'
  )

  it('spine: ImportOrchestrator seals journal.fileResources = plan.resources and reports plan.toRestore/skips', async () => {
    const now = Date.now()
    seedBackup((db) => {
      seedRow(db, 'file_entry', { id: 'fe-1', origin: 'internal', name: 'pic.png', size: 14, ext: 'png' })
      db.prepare(
        `INSERT INTO knowledge_base (
           id, name, embedding_model_id, dimensions, status, chunk_size, chunk_overlap, created_at, updated_at
         ) VALUES (?, ?, NULL, NULL, 'completed', 500, 50, ?, ?)`
      ).run('kb-1', 'kb-1', now, now)
      db.prepare(
        `INSERT INTO agent_global_skill (id, name, folder_name, source, tags, content_hash, is_enabled, created_at, updated_at)
         VALUES (?, ?, ?, 'local', '[]', 'hash', 1, ?, ?)`
      ).run('skill-1', 'my-skill', 'my-skill', now, now)
    })
    await buildFullArchive({
      stageRoot: tmpDir,
      archivePath,
      dbCopyPath: backupDbPath,
      files: [{ id: 'fe-1', content: 'blob-content-1' }],
      knowledgeBases: [{ baseId: 'kb-1', files: { 'doc.md': 'kb doc' } }],
      skills: [{ folderName: 'my-skill', files: { 'SKILL.md': 'skill doc' } }],
      notes: [{ relPath: 'folder/note.md', content: 'note body' }]
    })

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
      planResources,
      planRoots: {
        files: filesRoot,
        knowledge: join(tmpDir, 'Data', 'KnowledgeBase'),
        skills: join(tmpDir, 'Data', 'Skills'),
        // No managed notes root → note paths become plan.skips (not journal fields).
        notes: () => undefined
      }
    })

    const restoreId = 'rst-e2e-full-res-spine'
    const result = await new ImportOrchestrator(makeDeps()).importBackup({ archivePath, restoreId })

    expect(result.plan.toRestore).toEqual([
      { kind: 'file', count: 1 },
      { kind: 'knowledge', count: 1 },
      { kind: 'skill', count: 1 }
    ])
    expect(result.plan.skips).toEqual([{ id: 'folder/note.md', kind: 'note', reason: 'no managed notesRoot' }])
    expect(result.plan.resources).toHaveLength(3)

    const journal = readRestoreJournal()
    expect(journal.kind).toBe('ok')
    if (journal.kind !== 'ok') throw new Error('unreachable')
    // P1-5: journal carries additive resources only — skips stay on the in-memory plan.
    expect(journal.journal.fileResources).toEqual(result.plan.resources)
    expect(journal.journal).not.toHaveProperty('skips')
  })

  // restorePromotion e2e — follow-up beyond A2
  it.todo(
    'spine: staged journal add-target appears before boot → whole batch clean-expires (e2e over restorePromotion) — follow-up'
  )
})
