// File blob staging — copies file_entry blobs + knowledge base dirs from their
// live on-disk locations into temp staging dirs (files/<id>, knowledge/<baseId>/)
// for archive assembly. A missing source is SKIPPED, not fatal: an external file
// the user moved, or a knowledge base dir absent on disk, must not abort the
// whole export — the manifest records only what was actually staged.
//
// Backed by the live DB (file_entry rows resolve id → source path) and the two
// live filesystem roots:
//   - feature.files.data         (internal blobs: <id>.<ext>)
//   - feature.knowledgebase.data (per-base dirs: <baseId>/)

import { copyFile, cp, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

import { loggerService } from '@logger'
import type { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { isPathInside } from '@main/utils/legacyFile'
import { and, inArray, isNull } from 'drizzle-orm'

const logger = loggerService.withContext('backup/FileStager')

/** True if `e` is a Node fs error with the given code (e.g. 'ENOENT' = source gone). */
const isErrnoCode = (e: unknown, code: string): boolean => (e as NodeJS.ErrnoException | undefined)?.code === code

/**
 * Re-stat a source after an EACCES/EPERM copy failure to decide whether the
 * error was the source (now gone/unreadable → treat as missing) or the
 * destination (still present → a real write error that must abort). stat does
 * NOT prove readability (a mode-000 file stats fine), but a source that is
 * still present after an EACCES/EPERM is far more likely a dest-volume
 * permission issue, and aborting there is safer than silently dropping a blob
 * the DB references (never delete local data).
 */
const isSourceGone = async (src: string): Promise<boolean> => {
  try {
    await stat(src)
    return false
  } catch (e) {
    // Only a definitive "not there" result counts as gone. A permission error
    // (EACCES/EPERM/ELOOP/...) on re-stat means the source is still present but
    // inaccessible — treat as NOT gone so the original copy error rethrows and
    // the export aborts rather than silently dropping the blob (a present but
    // unreadable source must NOT be recorded missing, since ExportOrchestrator
    // prunes missing rows from backup.sqlite → never delete local data).
    return isErrnoCode(e, 'ENOENT') || isErrnoCode(e, 'ENOTDIR')
  }
}

/**
 * True if `e` is a definitive "path absent" fs error (ENOENT/ENOTDIR). Used on the
 * pre-copy stat: only these mean the source is genuinely gone; EACCES/EPERM/EIO/
 * ELOOP mean the path may exist but be unreadable, so the caller MUST abort — never
 * silently drop a blob the DB references (pruneMissingRows would otherwise delete
 * the row → silent data loss, #16683 P1).
 */
const isMissingPath = (e: unknown): boolean => isErrnoCode(e, 'ENOENT') || isErrnoCode(e, 'ENOTDIR')

/** Result of staging file blobs: how many copied, total bytes, which ids were missing. */
export interface StageFilesResult {
  readonly total: number
  readonly totalBytes: number
  readonly missing: readonly string[]
}

/** Result of staging knowledge base dirs: which baseIds copied, which were missing. */
export interface StageKnowledgeResult {
  readonly bases: readonly string[]
  readonly missing: readonly string[]
}

/** Result of staging notes markdown: which relative paths copied, which were missing. */
export interface StageNotesResult {
  readonly paths: readonly string[]
  readonly missing: readonly string[]
}

/**
 * Port: stage file blobs + knowledge base dirs into temp dirs. Injected into
 * ExportOrchestrator so the IO + DB resolution is testable in isolation.
 */
export interface FileStager {
  stageFiles(fileIds: ReadonlySet<string>, destDir: string): Promise<StageFilesResult>
  stageKnowledge(baseIds: ReadonlySet<string>, destDir: string): Promise<StageKnowledgeResult>
  stageNotes(notesRoot: string, relPaths: ReadonlySet<string>, destDir: string): Promise<StageNotesResult>
}

/**
 * Resolves each id against file_entry (only non-deleted rows), copies the blob
 * to <destDir>/<id>, and sums actual on-disk sizes. Internal blobs are read from
 * <filesRoot>/<id>.<ext>; external blobs from the row's absolute externalPath.
 * Ids whose file_entry was soft-deleted or whose source file is unreadable land
 * in `missing` instead of throwing.
 */
export class SqliteFileStager implements FileStager {
  constructor(
    private readonly liveDb: BackupReadonlyDb,
    private readonly filesRoot: string,
    private readonly knowledgeRoot: string
  ) {}

  async stageFiles(fileIds: ReadonlySet<string>, destDir: string): Promise<StageFilesResult> {
    if (fileIds.size === 0) return { total: 0, totalBytes: 0, missing: [] }
    await mkdir(destDir, { recursive: true })

    const ids = [...fileIds]
    // Chunk the lookup — a single IN(...) over a large file library can exceed
    // SQLite's bound-variable limit (SQLITE_MAX_VARIABLE_NUMBER, default 999) and
    // abort the export with "too many SQL variables". 500 stays well under it.
    const CHUNK = 500
    const rows: Array<(typeof fileEntryTable)['$inferSelect']> = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK)
      // Only non-deleted rows are staged; a soft-deleted file_entry (e.g. referenced
      // by an un-pruned painting_file_ref) is reported missing rather than copied.
      const r = await this.liveDb
        .select()
        .from(fileEntryTable)
        .where(and(inArray(fileEntryTable.id, batch), isNull(fileEntryTable.deletedAt)))
      rows.push(...r)
    }

    const foundIds = new Set(rows.map((r) => r.id))
    let total = 0
    let totalBytes = 0
    const missing: string[] = []

    // Ids absent from file_entry entirely (deleted row, or a stale ref) are missing.
    for (const id of ids) if (!foundIds.has(id)) missing.push(id)

    for (const row of rows) {
      // Internal blobs live at <filesRoot>/<id>.<ext>; extensionless internals use <id>.
      // External blobs live at the row's absolute externalPath (may be outside userData).
      const src =
        row.origin === 'internal' ? join(this.filesRoot, row.ext ? `${row.id}.${row.ext}` : row.id) : row.externalPath
      if (!src) {
        // external row with NULL externalPath violates fe_origin_consistency; treat as missing.
        missing.push(row.id)
        continue
      }
      let size: number
      try {
        const s = await stat(src)
        // A non-file entry at the source path (e.g. a directory where a blob is
        // expected) is treated as missing — the row is valid but the blob isn't.
        if (!s.isFile()) {
          missing.push(row.id)
          continue
        }
        size = s.size
      } catch (e) {
        // Only a definitively-absent source (ENOENT/ENOTDIR) is missing; EACCES/
        // EPERM/EIO mean the path may exist but be unreadable — abort instead of
        // silently dropping a blob the DB references (pruneMissingRows would
        // otherwise delete the row → never delete local data, #16683 P1).
        if (isMissingPath(e)) {
          missing.push(row.id)
          continue
        }
        throw e
      }
      // stat succeeded → the source existed at check time. A copyFile failure now
      // is usually a DESTINATION write error (disk-full / permission) and MUST
      // abort (the archive would otherwise omit a blob its DB references). But an
      // ENOENT here means the source disappeared between stat and copy (external
      // file moved/deleted) → treat as missing, not a write error.
      const dest = join(destDir, row.id)
      try {
        await copyFile(src, dest)
      } catch (e) {
        // ENOENT = source gone (stat→copy race) → missing. EACCES/EPERM is
        // ambiguous — unreadable source (mode 000) OR a dest write-permission
        // failure — so re-stat the source to disambiguate: source gone → missing;
        // source still present → dest write error, MUST abort (the archive would
        // otherwise omit a blob its DB references). ENOSPC / other system errors
        // always abort.
        if (isErrnoCode(e, 'ENOENT')) {
          // A failed copy may have written partial bytes to dest — remove it so the
          // archive never holds an unmanifested blob (codex review).
          await rm(dest, { force: true }).catch(() => {})
          missing.push(row.id)
          continue
        }
        if ((isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) && (await isSourceGone(src))) {
          await rm(dest, { force: true }).catch(() => {})
          missing.push(row.id)
          continue
        }
        throw e
      }
      total += 1
      totalBytes += size
    }

    return { total, totalBytes, missing }
  }

  async stageKnowledge(baseIds: ReadonlySet<string>, destDir: string): Promise<StageKnowledgeResult> {
    if (baseIds.size === 0) return { bases: [], missing: [] }
    await mkdir(destDir, { recursive: true })

    const bases: string[] = []
    const missing: string[] = []
    for (const baseId of baseIds) {
      const src = join(this.knowledgeRoot, baseId)
      let dirStat
      try {
        dirStat = await stat(src)
      } catch (e) {
        // Only a definitively-absent base dir (ENOENT/ENOTDIR) is missing; EACCES/
        // EPERM/EIO mean the dir may exist but be unreadable — abort instead of
        // silently dropping a base the DB references (#16683 P1).
        if (isMissingPath(e)) {
          missing.push(baseId)
          continue
        }
        throw e
      }
      if (!dirStat.isDirectory()) {
        missing.push(baseId)
        continue
      }
      const dest = join(destDir, baseId)
      await mkdir(dest, { recursive: true })
      // TODO(knowledge-index-consistency): raw `cp` of a WAL-mode .cherry/index.sqlite
      // can capture the main DB and -wal/-shm from different moments, so a restored
      // base may carry a stale/corrupt index. Land a checkpoint or a SQLite backup-API
      // copy under the knowledge-base mutation lock (or exclude + rebuild on restore)
      // before this path serves users who index while exporting.
      try {
        await cp(src, dest, { recursive: true })
      } catch (e) {
        // ENOENT = source gone mid-copy → missing. EACCES/EPERM is ambiguous
        // (unreadable source vs dest permission) — re-stat to disambiguate. On a
        // confirmed missing source, remove any partial dest so the archive never
        // holds a half-copied base that manifest.knowledge says was absent
        // (best-effort; an rm failure is swallowed — the base is already recorded
        // missing). A still-present source means a dest write error → abort.
        const sourceMissing =
          isErrnoCode(e, 'ENOENT') ||
          ((isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) && (await isSourceGone(src)))
        if (sourceMissing) {
          await rm(dest, { recursive: true, force: true }).catch(() => {})
          missing.push(baseId)
          continue
        }
        throw e
      }
      bases.push(baseId)
    }
    return { bases, missing }
  }

  /**
   * Copy each `<notesRoot>/<relPath>` markdown file to `<destDir>/<relPath>`,
   * preserving sub-directory structure (mkdir recursive). Missing/unreadable
   * sources (ENOENT / EACCES / EPERM) are skip-and-continue — recorded in
   * `missing` rather than aborting the export — matching stageFiles/stageKnowledge.
   * Other errors (ENOSPC etc.) throw. Empty input returns
   * `{ paths: [], missing: [] }`.
   */
  async stageNotes(notesRoot: string, relPaths: ReadonlySet<string>, destDir: string): Promise<StageNotesResult> {
    if (relPaths.size === 0) return { paths: [], missing: [] }
    await mkdir(destDir, { recursive: true })

    // Canonical notes root for realpath containment — blocks copy through a
    // junction/symlink whose lexical path is under notesRoot but resolves outside.
    let realRoot: string
    try {
      realRoot = await realpath(notesRoot)
    } catch {
      realRoot = resolve(notesRoot)
    }

    const staged: string[] = []
    const missing: string[] = []
    for (const rel of relPaths) {
      // Containment guard: reject `..` path segments and any resolve that escapes
      // notesRoot — treat as missing (same as an absent source) so a crafted rel
      // cannot copy a file from outside the Notes tree into the archive.
      const escapes = rel.split(/[/\\]/).includes('..') || !isPathInside(resolve(notesRoot, rel), notesRoot)
      if (escapes) {
        logger.warn('stageNotes: path outside notes root skipped', { rel, notesRoot })
        missing.push(rel)
        continue
      }
      const src = join(notesRoot, rel)
      // realpath follows junctions/symlinks; refuse sources that land outside root.
      try {
        const realSrc = await realpath(src)
        if (!isPathInside(realSrc, realRoot)) {
          logger.warn('stageNotes: source realpath outside notes root skipped', {
            rel,
            realSrc,
            notesRoot
          })
          missing.push(rel)
          continue
        }
      } catch {
        // Missing / unreadable — copyFile below classifies ENOENT vs hard errors.
      }
      const dest = join(destDir, rel)
      // Ensure the destination sub-directory exists (rel may be `sub/note.md`).
      await mkdir(dirname(dest), { recursive: true })
      try {
        await copyFile(src, dest)
      } catch (e) {
        // ENOENT = source gone → missing. EACCES/EPERM is ambiguous (unreadable
        // source vs dest permission) — re-stat the source: gone → missing, still
        // present → dest write error, MUST abort. ENOSPC / other system errors
        // always abort.
        if (isErrnoCode(e, 'ENOENT')) {
          missing.push(rel)
          continue
        }
        if ((isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) && (await isSourceGone(src))) {
          missing.push(rel)
          continue
        }
        throw e
      }
      staged.push(rel)
    }
    return { paths: staged, missing }
  }
}

/** Test double — records calls + returns canned results. No IO. */
export class StubFileStager implements FileStager {
  constructor(
    private readonly filesResult: StageFilesResult = { total: 0, totalBytes: 0, missing: [] },
    private readonly knowledgeResult: StageKnowledgeResult = { bases: [], missing: [] },
    private readonly notesResult: StageNotesResult = { paths: [], missing: [] }
  ) {}
  async stageFiles(): Promise<StageFilesResult> {
    return this.filesResult
  }
  async stageKnowledge(): Promise<StageKnowledgeResult> {
    return this.knowledgeResult
  }
  async stageNotes(): Promise<StageNotesResult> {
    return this.notesResult
  }
}
