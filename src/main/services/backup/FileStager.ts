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

import { copyFile, cp, mkdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'

import { and, inArray, isNull } from 'drizzle-orm'
import type { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { fileEntryTable } from '@main/data/db/schemas/file'

/** True if `e` is a Node fs error with the given code (e.g. 'ENOENT' = source gone). */
const isErrnoCode = (e: unknown, code: string): boolean =>
  (e as NodeJS.ErrnoException | undefined)?.code === code

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

/**
 * Port: stage file blobs + knowledge base dirs into temp dirs. Injected into
 * ExportOrchestrator so the IO + DB resolution is testable in isolation.
 */
export interface FileStager {
  stageFiles(fileIds: ReadonlySet<string>, destDir: string): Promise<StageFilesResult>
  stageKnowledge(baseIds: ReadonlySet<string>, destDir: string): Promise<StageKnowledgeResult>
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
        row.origin === 'internal'
          ? join(this.filesRoot, row.ext ? `${row.id}.${row.ext}` : row.id)
          : row.externalPath
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
      } catch {
        // Source missing/unreadable (external file moved, internal blob deleted
        // out-of-band) → skip, don't fail the export.
        missing.push(row.id)
        continue
      }
      // stat succeeded → the source existed at check time. A copyFile failure now
      // is usually a DESTINATION write error (disk-full / permission) and MUST
      // abort (the archive would otherwise omit a blob its DB references). But an
      // ENOENT here means the source disappeared between stat and copy (external
      // file moved/deleted) → treat as missing, not a write error.
      try {
        await copyFile(src, join(destDir, row.id))
      } catch (e) {
        // ENOENT = source gone (stat→copy race); EACCES/EPERM = source unreadable
        // (e.g. mode 000) or a dest permission issue — either way the stager
        // contract treats an unusable source as missing rather than aborting the
        // whole export. ENOSPC / other system errors still abort (dest write fail).
        if (isErrnoCode(e, 'ENOENT') || isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) {
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
      } catch {
        // Base dir missing on disk (base row exists in DB but files were never
        // written or were removed) — skip, don't fail the export.
        missing.push(baseId)
        continue
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
        if (isErrnoCode(e, 'ENOENT') || isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) {
          // Source gone/unreadable mid-copy — remove any partial dest so the
          // archive never holds a half-copied base that manifest.knowledge says
          // was absent. Best-effort cleanup; an rm failure here is swallowed
          // (the base is already recorded missing, and a stray empty dir does
          // not desync the manifest — only its own absence is recorded).
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
}

/** Test double — records calls + returns canned results. No IO. */
export class StubFileStager implements FileStager {
  constructor(
    private readonly filesResult: StageFilesResult = { total: 0, totalBytes: 0, missing: [] },
    private readonly knowledgeResult: StageKnowledgeResult = { bases: [], missing: [] }
  ) {}
  async stageFiles(): Promise<StageFilesResult> {
    return this.filesResult
  }
  async stageKnowledge(): Promise<StageKnowledgeResult> {
    return this.knowledgeResult
  }
}
