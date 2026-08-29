// t1 — Notes overlay path bug (restore side). Full-preset restore must import the
// `note` overlay rows (isStarred/isExpanded) for notes whose body was staged AND
// rewrite their (rootPath, path) to THIS host's form so the renderer can join them.
//
// The overlay identity is the natural key (rootPath, path). Both columns are stored
// as ABSOLUTE paths in production:
//   - rootPath = the notes root (resolveNotesRoot, OS-raw)
//   - path     = normalizePathValue(node.externalPath) — the file-tree builder stores
//                absPath verbatim (builder.ts:405/413); the renderer only forward-slash
//                normalizes it, preserving the absolute form.
//
// But the backup/restore pipeline's note identity (collectNotesMarkdown, stageNotes,
// manifest.notes.paths, ResourcePlan.noteAdditions) is all keyed by the
// notesRoot-RELATIVE POSIX path. Two failures follow:
//   1. MergeEngine looks up noteAdditions with the ABSOLUTE row.path → always misses
//      → overlay SKIPped (star/expand state never imported).
//   2. Even when imported, only rootPath is rewritten to the host root; path keeps
//      the BACKUP machine's absolute value → the host renderer (querying with the
//      host's absolute externalPath) cannot join the restored row → state invisible.
//
// A correct engine resolves the backup row's (rootPath, path) to a relative key,
// looks up noteAdditions, then rewrites BOTH rootPath (host root) and path
// (host root + relative) so the restored row is renderer-joinable. This file
// reproduces the miss + the unjoinable-write before the fix lands.

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { contributorManager } from '@main/services/backup/contributors/ContributorManager'
import { setupTestDatabase } from '@test-helpers/db'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { MergeEngine } from '../MergeEngine'
import type { MergeContext } from '../types'

describe('MergeEngine note overlay path bug (t1)', () => {
  // Live test DB = the merge base (work.sqlite). Production migrations + FTS5.
  const dbh = setupTestDatabase()
  const registry = contributorManager.getRegistry()

  let tmpDir: string
  let backupPath: string

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'cs-merge-note-'))
    backupPath = join(tmpDir, 'backup.sqlite')
    await dbh.sqlite.backup(backupPath)
  })

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  /** Seed the synthetic backup.sqlite with raw rows in one tx (FK enforcement ON). */
  const seedBackup = (seed: (db: Database.Database) => void): void => {
    const db = new Database(backupPath)
    try {
      db.pragma('foreign_keys = ON')
      db.transaction(seed)(db)
    } finally {
      db.close()
    }
  }

  /**
   * Insert a note overlay row (snake_case physical columns). A note row MUST carry
   * state (check constraint: isStarred OR isExpanded). `path` is the ABSOLUTE
   * externalPath the renderer writes — mirroring production, NOT the relative form
   * some export test fixtures happen to use.
   */
  const insertNote = (
    db: Database.Database,
    id: string,
    rootPath: string,
    path: string,
    opts: { isStarred?: boolean; isExpanded?: boolean } = {}
  ): void => {
    const isStarred = opts.isStarred ?? true
    const isExpanded = opts.isExpanded ?? true
    const now = Date.now()
    db.prepare(
      `INSERT INTO note (id, root_path, path, is_starred, is_expanded, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, rootPath, path, isStarred ? 1 : 0, isExpanded ? 1 : 0, now, now)
  }

  const countNotes = (): number => (dbh.sqlite.prepare(`SELECT COUNT(*) AS c FROM note`).get() as { c: number }).c

  const runMerge = (ctx: MergeContext): Promise<unknown> =>
    new MergeEngine(registry).mergeBackupIntoWork(dbh.sqlite, dbh.db, ctx)

  /**
   * Build a PREFERENCES-scope merge ctx with a noteAdditions plan. noteAdditions is
   * keyed by the notesRoot-relative path (production form from planResources); the
   * value is this host's resolved Notes root. includeFiles=true selects the full
   * overlay path (skipAllNotes is false).
   */
  const notesCtx = (noteAdditions: ReadonlyMap<string, string>): MergeContext => ({
    backupDbPath: backupPath,
    domains: ['PREFERENCES'],
    skippedFileEntryIds: new Set<string>(),
    stagedFileEntryIds: new Set<string>(),
    includeFiles: true,
    resourcePlan: { noteAdditions }
  })

  it('imports a note overlay and rewrites (rootPath, path) to the host form (renderer-joinable)', async () => {
    // Backup machine row: absolute backup root + absolute backup externalPath.
    // noteAdditions maps the RELATIVE body path → this host's notes root.
    // A correct engine: derives relPath from the backup row → looks up noteAdditions
    // → rewrites rootPath to the host root AND path to host-root/relPath so the host
    // renderer (querying with the host's absolute externalPath) can join the row.
    const backupRoot = '/home/user/notes'
    const hostRoot = '/appdata/notes'
    seedBackup((db) => {
      insertNote(db, 'note-1', backupRoot, `${backupRoot}/note.md`, { isStarred: true, isExpanded: false })
    })

    await runMerge(notesCtx(new Map([['note.md', hostRoot]])))

    // Overlay imported exactly once, with host-form identity + preserved state.
    expect(countNotes()).toBe(1)
    const row = dbh.sqlite
      .prepare(`SELECT root_path, path, is_starred, is_expanded FROM note WHERE id = 'note-1'`)
      .get() as { root_path: string; path: string; is_starred: number; is_expanded: number }
    expect(row.root_path).toBe(hostRoot)
    // path rewritten to the HOST absolute externalPath (hostRoot/relPath), not the
    // backup machine's absolute value — otherwise the renderer cannot join it.
    expect(row.path).toBe(`${hostRoot}/note.md`)
    expect(row.is_starred).toBe(1)
    expect(row.is_expanded).toBe(0)
  })

  it('SKIPs a note overlay whose body was NOT staged (absent from noteAdditions)', async () => {
    // An overlay whose markdown body is not in the archive must not land in work
    // (would point at a missing file). Only note.md is staged.
    const backupRoot = '/home/user/notes'
    const hostRoot = '/appdata/notes'
    seedBackup((db) => {
      insertNote(db, 'note-staged', backupRoot, `${backupRoot}/note.md`)
      insertNote(db, 'note-unstaged', backupRoot, `${backupRoot}/other.md`)
    })

    await runMerge(notesCtx(new Map([['note.md', hostRoot]])))

    // Only the staged overlay is imported; the unstaged one is SKIPped.
    expect(countNotes()).toBe(1)
    const ids = (dbh.sqlite.prepare(`SELECT id FROM note`).all() as { id: string }[]).map((r) => r.id)
    expect(ids).toEqual(['note-staged'])
  })

  it('FIELD_MERGEs a note overlay already present on the host (no duplicate, local state kept)', async () => {
    // The host already has the overlay written by its own renderer: host-form
    // (rootPath, path) — both absolute on THIS machine. The backup carries the same
    // note (different machine's absolute paths). Natural-key identity must match
    // AFTER the backup row is rewritten to host form → FIELD_MERGE keeps local
    // non-null state, no duplicate row.
    const hostRoot = '/appdata/notes'
    dbh.sqlite
      .prepare(
        `INSERT INTO note (id, root_path, path, is_starred, is_expanded, created_at, updated_at)
         VALUES ('note-local', ?, ?, 1, 0, ?, ?)`
      )
      .run(hostRoot, `${hostRoot}/note.md`, Date.now(), Date.now())

    const backupRoot = '/home/user/notes'
    seedBackup((db) => {
      insertNote(db, 'note-backup', backupRoot, `${backupRoot}/note.md`, { isStarred: false, isExpanded: true })
    })

    await runMerge(notesCtx(new Map([['note.md', hostRoot]])))

    // Exactly one row at the host identity (no duplicate); local starred state wins.
    expect(countNotes()).toBe(1)
    const row = dbh.sqlite.prepare(`SELECT root_path, path, is_starred, is_expanded FROM note`).get() as {
      root_path: string
      path: string
      is_starred: number
      is_expanded: number
    }
    expect(row.root_path).toBe(hostRoot)
    expect(row.path).toBe(`${hostRoot}/note.md`)
    expect(row.is_starred).toBe(1)
  })

  it('writes forward-slash-normalized (rootPath, path) from a Windows-shaped backup + host root', async () => {
    // Backup machine is Windows: rootPath + path carry backslashes. The host root
    // (noteAdditions value) is also OS-raw Windows. The renderer forward-slash
    // normalizes on write; restore must match that shape or the unique index and
    // renderer joins break. Both columns must come out POSIX-normalized.
    const backupRoot = 'C:\\Users\\me\\notes'
    const hostRoot = 'C:\\Users\\me\\appdata\\notes'
    seedBackup((db) => {
      insertNote(db, 'note-win', backupRoot, `${backupRoot}\\sub\\note.md`, { isStarred: true, isExpanded: false })
    })

    await runMerge(notesCtx(new Map([['sub/note.md', hostRoot]])))

    expect(countNotes()).toBe(1)
    const row = dbh.sqlite.prepare(`SELECT root_path, path, is_starred FROM note WHERE id = 'note-win'`).get() as {
      root_path: string
      path: string
      is_starred: number
    }
    // Both columns forward-slash normalized to the host form (renderer-joinable).
    expect(row.root_path).toBe('C:/Users/me/appdata/notes')
    expect(row.path).toBe('C:/Users/me/appdata/notes/sub/note.md')
    expect(row.is_starred).toBe(1)
  })
})
