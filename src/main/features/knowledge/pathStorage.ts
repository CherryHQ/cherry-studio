import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { copy, ensureDir, type PathReadability, probeReadable, remove, removeDir, write } from '@main/utils/file'
import { nextFreeKnowledgeRelativePath } from '@main/utils/knowledge'
import { getFileExt } from '@main/utils/legacyFile'
import { KnowledgeRelativePathSchema } from '@shared/data/types/knowledge'
import { type AbsoluteFilePath, AbsoluteFilePathSchema } from '@shared/types/file'
import {
  knowledgeFileProcessingExts,
  type PosixRelativeFilePath,
  resolvePosixRelativeSegments
} from '@shared/utils/file'

const logger = loggerService.withContext('Knowledge:PathStorage')

// A processed `.md` artifact is emitted iff the source actually runs through the file
// processor, so reservation keys off the same processing-ext source of truth that
// `needsFileProcessing` (sourcePlanning) uses. Sharing it keeps import-time name
// selection and scheduling in agreement — were they to diverge, a name chosen at
// import could collide with the artifact a later processing job writes.
const KNOWLEDGE_FILE_PROCESSING_EXT_SET = new Set<string>(knowledgeFileProcessingExts)

/**
 * The control dir (`{baseDir}/.cherry`) holding the derived index, sibling to `raw/`.
 * Exported because it is also a reserved *material* name: `assertSafeKnowledgeRelativePath`
 * rejects a `relativePath` of `.cherry` (or under it), so anything choosing a top-level
 * material name must treat it as already taken rather than emit a path that throws on
 * every read.
 */
export const CHERRY_META_DIR = '.cherry'
const VECTOR_STORE_FILE = 'index.sqlite'

/**
 * The single material root inside a base dir. All material bytes live flat under
 * `{baseDir}/raw/`, a sibling of the `.cherry/` control dir (which holds the
 * derived index). A `relativePath` is always relative to this root; byte
 * resolution is `{baseDir}/raw/{relativePath}` (knowledge-technical-design.md §2).
 * Materials are not sub-partitioned by import-action type — the directory layout
 * is internal and type/origin is read from `knowledge_item`, never the path.
 */
const MATERIAL_ROOT_DIR = 'raw'

export function getKnowledgeBaseDir(baseId: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(path.join(application.getPath('feature.knowledgebase.data'), baseId))
}

/** The material root (`{baseDir}/raw`) under which every `relativePath` resolves. */
export function getKnowledgeMaterialDir(baseId: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(path.join(getKnowledgeBaseDir(baseId), MATERIAL_ROOT_DIR))
}

function getKnowledgeBaseMetaDir(baseId: string): AbsoluteFilePath {
  return AbsoluteFilePathSchema.parse(path.join(getKnowledgeBaseDir(baseId), CHERRY_META_DIR))
}

/**
 * The base's index.sqlite path. No `ensureDir` here — `openBetterSqlite3IndexDriver`
 * (BetterSqlite3Driver.ts) already `mkdirSync`s the parent `.cherry/` dir itself before
 * opening, so a caller that only needs the path (not a guaranteed-existing directory)
 * does not need to duplicate that work.
 */
export function getKnowledgeVectorStoreFilePathSync(baseId: string): AbsoluteFilePath {
  const metaDir = getKnowledgeBaseMetaDir(baseId)
  return AbsoluteFilePathSchema.parse(path.join(metaDir, VECTOR_STORE_FILE))
}

export function getKnowledgeBaseFilePath(baseId: string, relativePath: string): AbsoluteFilePath {
  assertSafeKnowledgeRelativePath(relativePath)

  const materialDir = getKnowledgeMaterialDir(baseId)
  const resolved = path.join(materialDir, relativePath)
  assertResolvesBelow(materialDir, resolved, relativePath)
  return AbsoluteFilePathSchema.parse(resolved)
}

/**
 * Host-side half of the boundary guard: `assertSafeKnowledgeRelativePath` reads the value as
 * POSIX (the storage contract), `path.join` reads it as the host, and the two disagree about
 * `\` — so a legitimately stored `..\outside.pdf` climbs out of `raw/` on Windows, taking
 * `deleteKnowledgeItemFiles` with it.
 */
function assertResolvesBelow(materialDir: string, resolved: string, relativePath: string): void {
  const rel = path.relative(materialDir, resolved)
  // `''` means it landed back on the root — returning that as one item's file would let a
  // single-item delete take the whole tree.
  if (rel === '' || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    throw new Error(`Knowledge relative path escapes the material root on this platform: ${relativePath}`)
  }
}

/**
 * Probe a base-relative material file (`{baseDir}/raw/{relativePath}`), distinguishing a genuinely
 * absent file from one that could not be verified (see {@link probeReadable}).
 */
export async function probeKnowledgeFile(baseId: string, relativePath: string): Promise<PathReadability> {
  return probeReadable(getKnowledgeBaseFilePath(baseId, relativePath))
}

/**
 * Probe an absolute on-disk source path (e.g. a directory item's original folder, stored in
 * `data.source`), distinguishing a genuinely missing source from one that could not be verified.
 * Reindex rescans a directory from this path, so a missing source means there is nothing to rebuild
 * from; an unverifiable one (transient/permission error) may still exist. The stored `data.source`
 * is already absolute, so it is probed as-is.
 */
export async function probeKnowledgeSourcePath(absolutePath: string): Promise<PathReadability> {
  return probeReadable(AbsoluteFilePathSchema.parse(absolutePath))
}

export function getKnowledgeSourceRelativePath(sourcePath: string): PosixRelativeFilePath {
  const fileName = path.basename(sourcePath)
  assertSafeKnowledgeRelativePath(fileName)
  return fileName
}

export function getProcessedMarkdownRelativePath(relativePath: string): PosixRelativeFilePath {
  assertSafeKnowledgeRelativePath(relativePath)
  const parsed = path.parse(relativePath)
  // Re-asserted rather than inheriting the input's brand: swapping the extension
  // builds a NEW string, and `path.parse` on a dotfile (`.env` → name `.env`,
  // ext '') can turn one into `.env.md` — a different path that has to clear the
  // guard on its own.
  const processed = normalizeRelativePath(path.join(parsed.dir, `${parsed.name}.md`))
  assertSafeKnowledgeRelativePath(processed)
  return processed
}

/**
 * Reserve a free relative path for an imported material (auto-renaming on collision via
 * a `_N` suffix) and return it. When `reserveProcessedArtifact`, the prospective
 * processed-markdown sibling must also be free at the chosen suffix, and both are reserved
 * together — so a processor later emitting `paper.md` can never disagree with the source.
 * Mutates `reservedPaths`. The single dedup entry point: file imports (upload + the v1→v2
 * migrator's copied files) and URL-snapshot capture/restore all reserve names through it
 * (snapshots pass `false` — markdown has no processed artifact).
 */
export function reserveImportedFileRelativePath(
  sourceRelativePath: string,
  reserveProcessedArtifact: boolean,
  reservedPaths: Set<string>
): PosixRelativeFilePath {
  const chosen = nextFreeKnowledgeRelativePath(sourceRelativePath, (candidate) => {
    if (reservedPaths.has(candidate)) {
      return false
    }
    return !reserveProcessedArtifact || !reservedPaths.has(getProcessedMarkdownRelativePath(candidate))
  })

  // `nextFreeKnowledgeRelativePath` derives the suffixed name itself, so the
  // result is a new string that has not been through the guard — assert before
  // handing it out as a branded value.
  assertSafeKnowledgeRelativePath(chosen)
  reservedPaths.add(chosen)
  if (reserveProcessedArtifact) {
    reservedPaths.add(getProcessedMarkdownRelativePath(chosen))
  }
  return chosen
}

export async function copyFileIntoKnowledgeBaseAt(
  baseId: string,
  sourcePath: string,
  relativePath: PosixRelativeFilePath,
  options: { signal?: AbortSignal; overwrite?: boolean } = {}
): Promise<PosixRelativeFilePath> {
  const destPath = getKnowledgeBaseFilePath(baseId, relativePath)
  // `overwrite` lets directory expansion re-copy over its own orphans from a prior
  // aborted attempt (the prefix is unique per container, so a same-named dest can
  // only be that self-orphan). `copy` commits via tmp+rename, so overwrite is atomic.
  if (!options.overwrite) {
    await assertTargetAvailable(destPath)
  }
  await ensureDir(AbsoluteFilePathSchema.parse(path.dirname(destPath)))
  await copy(AbsoluteFilePathSchema.parse(sourcePath), destPath, options.signal)
  return relativePath
}

/**
 * Write in-memory content (e.g. a captured URL snapshot) to a base-relative file. `overwrite` is for
 * re-acquisition, which rewrites an item's own already-pinned snapshot in place; `write` commits via
 * tmp+rename, so the replacement is atomic.
 */
export async function writeFileIntoKnowledgeBaseAt(
  baseId: string,
  relativePath: PosixRelativeFilePath,
  content: string,
  options: { overwrite?: boolean } = {}
): Promise<PosixRelativeFilePath> {
  const destPath = getKnowledgeBaseFilePath(baseId, relativePath)
  if (!options.overwrite) {
    await assertTargetAvailable(destPath)
  }
  await ensureDir(AbsoluteFilePathSchema.parse(path.dirname(destPath)))
  await write(destPath, content)
  return relativePath
}

/**
 * Whether a source file, given the base's processor, will produce a processed
 * markdown artifact whose `.md` sibling slot must be reserved alongside it.
 */
export function needsProcessedArtifactReservation(
  fileProcessorId: string | null | undefined,
  relativePath: string
): boolean {
  if (!fileProcessorId) {
    return false
  }
  return KNOWLEDGE_FILE_PROCESSING_EXT_SET.has(getFileExt(relativePath).toLowerCase())
}

/**
 * The single source of truth for "which base-relative paths are already occupied":
 * every file's source + indexed-artifact path, and every captured URL/note snapshot
 * path. The reserved set the snapshot capture, the add-time dedup, and the
 * processed-artifact collision check all build from.
 *
 * - `fileProcessorId`: also reserve the *prospective* processed-markdown slot of a
 *   file whose artifact isn't pinned yet (so a name chosen now can't collide with
 *   the `.md` a later index will emit). Omit it when only on-disk paths matter.
 * - `excludeItemId`: skip that item's own paths — used to test a candidate path
 *   against every *other* item in the base.
 */
export function collectKnowledgeReservedRelativePaths(
  items: Array<{ id?: string; type: string; data: unknown }>,
  options: { fileProcessorId?: string | null; excludeItemId?: string } = {}
): Set<string> {
  const reserved = new Set<string>()
  for (const item of items) {
    if (options.excludeItemId !== undefined && item.id === options.excludeItemId) {
      continue
    }
    if (typeof item.data !== 'object' || item.data === null) {
      continue
    }
    const data = item.data as { relativePath?: unknown; indexedRelativePath?: unknown }
    if (typeof data.relativePath === 'string') {
      reserved.add(data.relativePath)
      if (
        item.type === 'file' &&
        typeof data.indexedRelativePath !== 'string' &&
        needsProcessedArtifactReservation(options.fileProcessorId, data.relativePath)
      ) {
        reserved.add(getProcessedMarkdownRelativePath(data.relativePath))
      }
    }
    if (typeof data.indexedRelativePath === 'string') {
      reserved.add(data.indexedRelativePath)
    }
  }
  return reserved
}

export async function assertKnowledgeFileTargetAvailable(baseId: string, relativePath: string): Promise<void> {
  await assertTargetAvailable(getKnowledgeBaseFilePath(baseId, relativePath))
}

export async function deleteKnowledgeItemFiles(
  baseId: string,
  items: Array<{ id?: string; type: string; data: unknown }>
): Promise<void> {
  // A directory container owns a whole `raw/<prefix>` subtree (its files plus nested
  // dirs) under its `relativePath`; remove it recursively in one shot.
  const directoryPrefixes = items
    .filter((item) => item.type === 'directory')
    .map((item) => (item.data as { relativePath?: unknown }).relativePath)
    .filter((relativePath): relativePath is string => typeof relativePath === 'string')
  await Promise.all(directoryPrefixes.map((prefix) => removeDir(getKnowledgeBaseFilePath(baseId, prefix))))

  // url/note snapshots and file leaves persist a `raw/{relativePath}` file too, so unlink
  // every stored path (mirroring collectKnowledgeReservedRelativePaths). Directory prefixes
  // are excluded here — `remove` is unlink-only and would EISDIR on a directory; the
  // removeDir above already took their files with them.
  const directoryPrefixSet = new Set(directoryPrefixes)
  const paths = collectKnowledgeReservedRelativePaths(items)
  await Promise.all(
    [...paths]
      .filter((relativePath) => !directoryPrefixSet.has(relativePath))
      .map((relativePath) => remove(getKnowledgeBaseFilePath(baseId, relativePath)))
  )
  // Backstop: prune any now-empty ancestor directories left behind — a migrated/legacy
  // directory predating the stored relativePath, or nested empties — deepest-first.
  await pruneEmptyKnowledgeMaterialDirs(baseId, paths)
}

/**
 * Delete every now-empty ancestor directory of `relativePaths`, deepest-first, up to —
 * but not including — the material root. `fs.rmdir` removes only an empty directory (a
 * still-populated one throws ENOTEMPTY, an already-gone one ENOENT — both ignored), so a
 * directory still holding another item's files is left untouched.
 */
async function pruneEmptyKnowledgeMaterialDirs(baseId: string, relativePaths: Set<string>): Promise<void> {
  const dirs = new Set<string>()
  for (const relativePath of relativePaths) {
    let dir = path.posix.dirname(relativePath)
    while (dir && dir !== '.' && dir !== '/') {
      dirs.add(dir)
      dir = path.posix.dirname(dir)
    }
  }
  // Deepest-first so a parent is only tested after its children were removed.
  const deepestFirst = [...dirs].sort((a, b) => b.split('/').length - a.split('/').length)
  for (const dir of deepestFirst) {
    try {
      await fs.rmdir(getKnowledgeBaseFilePath(baseId, dir))
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      // ENOTEMPTY (another item still lives here) and ENOENT (already gone) are the
      // expected, benign outcomes. Surface anything else (EACCES/EBUSY/…) as a warning
      // but never throw, so a stray husk can't abort the surrounding best-effort delete.
      if (code !== 'ENOTEMPTY' && code !== 'ENOENT') {
        logger.warn('Failed to prune empty knowledge material directory', { baseId, dir, code, err })
      }
    }
  }
}

/**
 * Best-effort variant of {@link deleteKnowledgeItemFiles}: a failed delete
 * (EACCES/EBUSY/... or a reserved/unsafe relativePath) is logged and swallowed
 * so it cannot abort the caller's primary operation (e.g. the subsequent DB row
 * deletion). Orphaned on-disk files are recoverable via full-base deletion;
 * a half-finished DB mutation is not.
 */
export async function deleteKnowledgeItemFilesBestEffort(
  baseId: string,
  items: Array<{ type: string; data: unknown }>,
  logContext: Record<string, unknown>
): Promise<void> {
  try {
    await deleteKnowledgeItemFiles(baseId, items)
  } catch (error) {
    logger.error(
      'Best-effort knowledge file cleanup failed; continuing',
      error instanceof Error ? error : new Error(String(error)),
      logContext
    )
  }
}

export async function deleteKnowledgeBaseDir(baseId: string): Promise<void> {
  await removeDir(getKnowledgeBaseDir(baseId))
}

/**
 * The filesystem-boundary guard for every material path, layered over the shape
 * rules rather than restating them:
 *
 * - **Shape** (not anchored to a root, no null byte, POSIX-legal segments) and
 *   **containment under `raw/`** both come from `KnowledgeRelativePathSchema`,
 *   the same gate on the four persisted `relativePath` fields. Kept here as
 *   defence in depth: paths derived *after* that schema ran
 *   (`getProcessedMarkdownRelativePath`, `nextFreeKnowledgeRelativePath`) reach
 *   the filesystem through this function without being re-parsed.
 * - **Reserved prefix** stays here, because it is about `raw/` specifically and
 *   not about relative paths in general.
 *
 * Reading the first POSIX segment rather than folding separators is what takes
 * this function off `normalizeRelativePath`, and it fixes a false rejection:
 * `.cherry\x` is one legal Linux filename sitting directly under `raw/`, not
 * something inside the reserved `.cherry/` directory. The old unconditional
 * `\`→`/` fold said otherwise (#17429).
 *
 * Declared as an assertion function, which makes it the sole producer of
 * `PosixRelativeFilePath` on this side: the helpers below return branded values
 * simply by asserting, with no cast anywhere.
 */
export function assertSafeKnowledgeRelativePath(relativePath: string): asserts relativePath is PosixRelativeFilePath {
  const parsed = KnowledgeRelativePathSchema.safeParse(relativePath)
  if (!parsed.success) {
    throw new Error(`Invalid knowledge relative path: ${relativePath}`)
  }

  // Non-null: the schema above already proved it resolves.
  const segments = resolvePosixRelativeSegments(relativePath) ?? []
  if (segments[0] === CHERRY_META_DIR) {
    throw new Error(`Knowledge relative path is reserved: ${relativePath}`)
  }
}

/**
 * Producer-side POSIX spelling for a path this module builds with `path.join`,
 * which emits `\` on Windows while material paths are stored `/`-separated.
 *
 * The fold is unconditional and therefore lossy on POSIX, where `\` is an
 * ordinary filename character: a source truly named `a\b.xls` yields `a/b.md`
 * here, one segment too deep. Tracked in #17429 — fixing it means teaching this
 * function the platform distinction that `pathSpec` now draws, which is out of
 * scope for the type work that removed its other caller.
 */
function normalizeRelativePath(relativePath: string): string {
  return path.normalize(relativePath).replace(/\\/g, '/')
}

async function assertTargetAvailable(destPath: AbsoluteFilePath): Promise<void> {
  try {
    await fs.lstat(destPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw error
  }

  throw new Error(`Knowledge file already exists: ${destPath}`)
}
