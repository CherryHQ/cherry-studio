// File blob staging — copies file_entry blobs + knowledge base dirs from their
// on-disk locations into temp staging dirs (files/<id>, knowledge/<baseId>/)
// for archive assembly. A missing source is SKIPPED, not fatal: an external file
// the user moved, or a knowledge base dir absent on disk, must not abort the
// whole export — the manifest records only what was actually staged.
//
// File blobs resolve paths from the **snapshot** file_entry row (readonly DB
// handle) + backup-local path resolution — never from live FileEntryService.
// Knowledge/skills use the live filesystem roots passed at construction:
//   - feature.knowledgebase.data (per-base dirs: <baseId>/)

import { copyFile, cp, mkdir, realpath, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import type { BackupReadonlyDb } from '@main/data/db/backup/contexts'
import { fileEntryTable } from '@main/data/db/schemas/file'
import { resolvePhysicalPath } from '@main/services/file'
import { isPathInside } from '@main/utils/file'
import { computeSkillContentHash } from '@main/utils/skillContentHash'
import { and, eq, inArray, isNull } from 'drizzle-orm'

const logger = loggerService.withContext('backup/SqliteFileStager')

/**
 * Derived per-base vector index (+ WAL sidecars) under `<baseId>/.cherry/`.
 * Basename set alone is not enough to exclude — user materials may also be named
 * `index.sqlite` (e.g. `raw/index.sqlite`) and must be retained. Callers must
 * combine with a `.cherry/` parent check (see {@link isExcludedKnowledgeIndexBasename}).
 */
export const KNOWLEDGE_INDEX_SQLITE_BASENAMES = new Set(['index.sqlite', 'index.sqlite-wal', 'index.sqlite-shm'])

/**
 * True when `sourcePath` is the derived vector index under `<baseId>/.cherry/`
 * (`index.sqlite` / `-wal` / `-shm`). `raw/index.sqlite` and other non-`.cherry`
 * paths are kept as user materials.
 */
export function isExcludedKnowledgeIndexBasename(sourcePath: string): boolean {
  if (!KNOWLEDGE_INDEX_SQLITE_BASENAMES.has(basename(sourcePath))) return false
  return basename(dirname(sourcePath)) === '.cherry'
}

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
 * Result of staging skill dirs: which {folderName, contentHash} were copied and which
 * sources were absent on disk. `missing` is a DEGRADATION channel, NOT a prune list —
 * the agent_global_skill row stays (the dir may be gone because the user moved it, not
 * because the registration is invalid), so callers must record it in
 * `manifest.degraded` and never route it into pruneMissingRows like file/knowledge.
 * Without it, a full backup silently ships a registered Skill whose non-re-downloadable
 * content the archive never carried.
 */
export interface StageSkillDirsResult {
  readonly skills: readonly { readonly folderName: string; readonly contentHash: string }[]
  readonly missing: readonly { readonly folderName: string; readonly contentHash: string }[]
}

/**
 * Port: stage file blobs + knowledge base dirs into temp dirs. Injected into
 * ExportOrchestrator so the IO + DB resolution is testable in isolation.
 */
export interface FileStager {
  stageFiles(fileIds: ReadonlySet<string>, destDir: string): Promise<StageFilesResult>
  stageKnowledge(baseIds: ReadonlySet<string>, destDir: string): Promise<StageKnowledgeResult>
  stageNotes(notesRoot: string, relPaths: ReadonlySet<string>, destDir: string): Promise<StageNotesResult>
  stageSkillDirs(
    skills: ReadonlyArray<{ readonly folderName: string; readonly contentHash: string }>,
    destDir: string
  ): Promise<StageSkillDirsResult>
}

/**
 * Resolves each id against file_entry (non-deleted **internal** rows only), copies
 * the blob to <destDir>/<id> via snapshot row + resolvePhysicalPath + fs.copyFile,
 * and sums actual on-disk sizes. External rows are dangling by design (architecture
 * §5.1) — TOPICS/PAINTINGS file_ref may still surface their ids, but export does
 * not copy absolute-path blobs. Ids whose file_entry was soft-deleted, external,
 * or whose source file is unreadable land in `missing` instead of throwing.
 */
export class SqliteFileStager implements FileStager {
  constructor(
    private readonly snapshotDb: BackupReadonlyDb,
    private readonly knowledgeRoot: string,
    private readonly skillsRoot: string
  ) {}

  async stageFiles(fileIds: ReadonlySet<string>, destDir: string): Promise<StageFilesResult> {
    if (fileIds.size === 0) return { total: 0, totalBytes: 0, missing: [] }
    await mkdir(destDir, { recursive: true })

    const filesRoot = application.getPath('feature.files.data')
    // Canonical file root for realpath containment — the atomic staging rename remains
    // the final backstop, but source validation must not follow links out of this root.
    let realRoot: string
    try {
      realRoot = await realpath(filesRoot)
    } catch {
      realRoot = resolve(filesRoot)
    }

    const ids = [...fileIds]
    // Chunk the lookup — a single IN(...) over a large file library can exceed
    // SQLite's bound-variable limit (SQLITE_MAX_VARIABLE_NUMBER, default 999) and
    // abort the export with "too many SQL variables". 500 stays well under it.
    const CHUNK = 500
    const rows: Array<(typeof fileEntryTable)['$inferSelect']> = []
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK)
      // Only non-deleted internal rows are staged. Soft-deleted rows and external
      // rows (dangling by design — architecture §5.1) are reported missing rather
      // than copied (file_ref domains may still collect external ids).
      const r = await this.snapshotDb
        .select()
        .from(fileEntryTable)
        .where(
          and(
            inArray(fileEntryTable.id, batch),
            eq(fileEntryTable.origin, 'internal'),
            isNull(fileEntryTable.deletedAt)
          )
        )
      rows.push(...r)
    }

    const foundIds = new Set(rows.map((r) => r.id))
    let total = 0
    let totalBytes = 0
    const missing: string[] = []

    // Ids absent from file_entry entirely (deleted row, or a stale ref) are missing.
    for (const id of ids) if (!foundIds.has(id)) missing.push(id)

    for (const row of rows) {
      // Reject traversal even when the database row contains an unexpected id; the
      // schema validation is defense-in-depth, not a substitute for this boundary.
      const escapes = row.id.split(/[/\\]/).includes('..') || !isPathInside(resolve(filesRoot, row.id), filesRoot)
      if (escapes) {
        logger.warn('stageFiles: path outside files root skipped', { id: row.id, filesRoot })
        missing.push(row.id)
        continue
      }
      const physicalPath = resolvePhysicalPath({
        id: row.id,
        origin: 'internal',
        ext: row.ext
      })
      // realpath follows junctions/symlinks; refuse blobs that land outside the
      // managed files root before copyFile can follow the link.
      try {
        const realSrc = await realpath(physicalPath)
        if (!isPathInside(realSrc, realRoot)) {
          logger.warn('stageFiles: source realpath outside files root skipped', {
            id: row.id,
            realSrc,
            filesRoot
          })
          missing.push(row.id)
          continue
        }
      } catch {
        // Missing / unreadable — copyFile below classifies ENOENT vs hard errors.
      }
      const dest = join(destDir, row.id)
      try {
        await copyFile(physicalPath, dest)
        const destStat = await stat(dest)
        if (destStat.isDirectory()) {
          throw Object.assign(new Error(`stageFiles: source is a directory (${row.id})`), { code: 'EISDIR' })
        }
        total += 1
        totalBytes += destStat.size
      } catch (e) {
        // ENOENT/ENOTDIR = source gone → missing. EACCES/EPERM is ambiguous —
        // unreadable source OR dest write-permission — so re-stat the source:
        // source gone → missing; source still present → dest write error, MUST abort.
        //
        // Cleanup rm is fail-closed: assembleArchive packages the WHOLE staging dir
        // (archive.directory, no manifest whitelist), so a (partial) dest we fail to
        // remove would ship while manifest.files omits its id → a false-positive export
        // of a corrupt archive. Let rm reject propagate (no outer catch in stageFiles)
        // and abort the export instead of recording the id missing.
        if (isErrnoCode(e, 'ENOENT') || isErrnoCode(e, 'ENOTDIR')) {
          await rm(dest, { force: true })
          missing.push(row.id)
          continue
        }
        if (isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) {
          try {
            await stat(physicalPath)
          } catch (metaErr) {
            if (isMissingPath(metaErr) || isErrnoCode(metaErr, 'ENOENT') || isErrnoCode(metaErr, 'ENOTDIR')) {
              await rm(dest, { force: true })
              missing.push(row.id)
              continue
            }
          }
          throw e
        }
        throw e
      }
    }

    return { total, totalBytes, missing }
  }

  async stageKnowledge(baseIds: ReadonlySet<string>, destDir: string): Promise<StageKnowledgeResult> {
    if (baseIds.size === 0) return { bases: [], missing: [] }
    await mkdir(destDir, { recursive: true })

    // Canonical knowledge root for realpath containment — the atomic staging rename
    // remains the final backstop, but cp must not follow a source link out of this root.
    let realRoot: string
    try {
      realRoot = await realpath(this.knowledgeRoot)
    } catch {
      realRoot = resolve(this.knowledgeRoot)
    }

    const bases: string[] = []
    const missing: string[] = []
    for (const baseId of baseIds) {
      // Reject traversal even when an unexpected base id bypasses schema validation.
      const escapes =
        baseId.split(/[/\\]/).includes('..') || !isPathInside(resolve(this.knowledgeRoot, baseId), this.knowledgeRoot)
      if (escapes) {
        logger.warn('stageKnowledge: path outside knowledge root skipped', {
          baseId,
          knowledgeRoot: this.knowledgeRoot
        })
        missing.push(baseId)
        continue
      }
      const src = join(this.knowledgeRoot, baseId)
      // realpath follows junctions/symlinks; refuse sources that land outside the
      // knowledge root before cp can copy the linked directory.
      try {
        const realSrc = await realpath(src)
        if (!isPathInside(realSrc, realRoot)) {
          logger.warn('stageKnowledge: source realpath outside knowledge root skipped', {
            baseId,
            realSrc,
            knowledgeRoot: this.knowledgeRoot
          })
          missing.push(baseId)
          continue
        }
      } catch {
        // Missing / unreadable — stat below classifies absent vs hard errors.
      }
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
      // R1: exclude derived `<baseId>/.cherry/index.sqlite{,-wal,-shm}` only (path +
      // basename). User materials like `raw/index.sqlite` are retained; restore
      // rebuilds the vector index via explicit `knowledge.index-documents` enqueue
      // after promotion/relaunch (empty index does not auto-rebuild — see
      // KnowledgeVectorStoreService.reportInvisibleIndexContents).
      try {
        await cp(src, dest, {
          recursive: true,
          filter: (sourcePath) => !isExcludedKnowledgeIndexBasename(sourcePath)
        })
      } catch (e) {
        // ENOENT = source gone mid-copy → missing. EACCES/EPERM is ambiguous
        // (unreadable source vs dest permission) — re-stat to disambiguate. On a
        // confirmed missing source, remove any partial dest so the archive never
        // holds a half-copied base that manifest.knowledge says was absent. This
        // cleanup is fail-closed: assembleArchive packages the WHOLE staging dir, so
        // a dest we fail to remove would ship while manifest.knowledge omits the base
        // → a false-positive export of a corrupt archive. Let rm reject propagate (no
        // outer catch in stageKnowledge) and abort. A still-present source means a
        // dest write error → abort.
        const sourceMissing =
          isErrnoCode(e, 'ENOENT') ||
          ((isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) && (await isSourceGone(src)))
        if (sourceMissing) {
          await rm(dest, { recursive: true, force: true })
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
   * Copy each `<skillsRoot>/<folderName>` skill directory to `<destDir>/<folderName>`
   * (full preset — zip/local, non-re-downloadable skills). Mirrors stageKnowledge's
   * cp-r + stat classification, but a skill dir is an ordinary file tree (NO WAL
   * caveat) and a missing dir is a DEGRADATION, not a prune: the agent_global_skill
   * row stays (the dir may be absent because the user moved it, not because the
   * registration is invalid). Successfully staged descriptors land in `skills`;
   * absent ones land in `missing` so the caller can record the degradation instead
   * of shipping a silently incomplete archive. EACCES/EIO/EPERM on a PRESENT source
   * aborts — never silently drop a non-re-downloadable skill the DB references.
   */
  async stageSkillDirs(
    skills: ReadonlyArray<{ readonly folderName: string; readonly contentHash: string }>,
    destDir: string
  ): Promise<StageSkillDirsResult> {
    if (skills.length === 0) return { skills: [], missing: [] }
    await mkdir(destDir, { recursive: true })

    // Canonical skills root for realpath containment — the atomic staging rename
    // remains the final backstop, but cp must not follow a source link out of this root.
    let realRoot: string
    try {
      realRoot = await realpath(this.skillsRoot)
    } catch {
      realRoot = resolve(this.skillsRoot)
    }

    const staged: { folderName: string; contentHash: string }[] = []
    const missing: { folderName: string; contentHash: string }[] = []
    for (const { folderName, contentHash } of skills) {
      // Reject traversal even when an unexpected folder name bypasses schema validation.
      const escapes =
        folderName.split(/[/\\]/).includes('..') || !isPathInside(resolve(this.skillsRoot, folderName), this.skillsRoot)
      if (escapes) {
        logger.warn('stageSkillDirs: path outside skills root skipped', {
          folderName,
          skillsRoot: this.skillsRoot
        })
        missing.push({ folderName, contentHash })
        continue
      }
      const src = join(this.skillsRoot, folderName)
      // realpath follows junctions/symlinks; refuse sources that land outside the
      // skills root before cp can copy the linked directory.
      try {
        const realSrc = await realpath(src)
        if (!isPathInside(realSrc, realRoot)) {
          logger.warn('stageSkillDirs: source realpath outside skills root skipped', {
            folderName,
            realSrc,
            skillsRoot: this.skillsRoot
          })
          missing.push({ folderName, contentHash })
          continue
        }
      } catch {
        // Missing / unreadable — stat below classifies absent vs hard errors.
      }
      let dirStat
      try {
        dirStat = await stat(src)
      } catch (e) {
        // Absent skill dir (ENOENT/ENOTDIR) = degradation, not fatal: report it as
        // missing (the row stays). EACCES/EIO/EPERM on a present dir aborts —
        // never silently drop a non-re-downloadable skill the DB references.
        if (isMissingPath(e)) {
          missing.push({ folderName, contentHash })
          continue
        }
        throw e
      }
      if (!dirStat.isDirectory()) {
        missing.push({ folderName, contentHash })
        continue
      }
      const dest = join(destDir, folderName)
      try {
        await cp(src, dest, { recursive: true })
      } catch (e) {
        // Source gone mid-copy (ENOENT, or EACCES/EPERM + confirmed gone) → report
        // missing and remove the partial dest. Cleanup is fail-closed: a leftover dest
        // would ship via assembleArchive's whole-dir packaging while manifest.skills
        // omits the folder → a false-positive export of a corrupt archive. Let rm
        // reject propagate (no outer catch intercepts this cp branch) and abort. Other
        // errors abort.
        const sourceMissing =
          isErrnoCode(e, 'ENOENT') ||
          ((isErrnoCode(e, 'EACCES') || isErrnoCode(e, 'EPERM')) && (await isSourceGone(src)))
        if (sourceMissing) {
          await rm(dest, { recursive: true, force: true })
          missing.push({ folderName, contentHash })
          continue
        }
        throw e
      }

      // Verify the copied descriptor before admitting the skill to the archive. This
      // catches a copy race or source change that would otherwise create a bad archive.
      // Cleanup rm on a failed verify is fail-closed for the same reason as the cp
      // branch: a leftover dest would ship via whole-dir packaging while manifest.skills
      // omits the folder → a false-positive export. An rm reject here is caught by the
      // outer catch below, which re-throws → export aborts.
      try {
        const stagedContentHash = await computeSkillContentHash(dest)
        if (!stagedContentHash) {
          await rm(dest, { recursive: true, force: true })
          missing.push({ folderName, contentHash })
          logger.warn('stageSkillDirs: staged skill is missing SKILL.md', {
            folderName,
            dest
          })
          continue
        }
        if (stagedContentHash !== contentHash) {
          await rm(dest, { recursive: true, force: true })
          missing.push({ folderName, contentHash })
          logger.warn('stageSkillDirs: staged skill content hash mismatch', {
            folderName,
            expectedContentHash: contentHash,
            actualContentHash: stagedContentHash
          })
          continue
        }
      } catch (error) {
        // A computeSkillContentHash read failure, or a cleanup-rm reject from the
        // branches above — remove the partial dest then re-throw so the export aborts.
        // The cleanup rm here is best-effort on purpose: this path always re-throws, so
        // a dest that survives rm can never reach an assembled archive (no
        // false-positive risk) — unlike the cp/hash branches above, which return missing.
        await rm(dest, { recursive: true, force: true }).catch(() => {})
        throw error
      }

      staged.push({ folderName, contentHash })
    }
    return { skills: staged, missing }
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
