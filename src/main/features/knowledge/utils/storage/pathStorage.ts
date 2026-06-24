import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { getFileExt } from '@main/utils/file'
import { copy, ensureDir, type PathReadability, probeReadable, remove, removeDir, write } from '@main/utils/file/fs'
import { nextFreeKnowledgeRelativePath } from '@main/utils/knowledge'
import type { FilePath } from '@shared/types/file'
import { knowledgeFileProcessingExts } from '@shared/utils/file'

const logger = loggerService.withContext('Knowledge:PathStorage')

// A processed `.md` artifact is emitted iff the source actually runs through the file
// processor — the exact predicate `needsFileProcessing` (sourcePlanning) uses. Keying
// reservation off the same processing-ext source of truth keeps the two from ever
// disagreeing (e.g. `.xls`, which is processed but not in the app-wide `documentExts`).
const KNOWLEDGE_FILE_PROCESSING_EXT_SET = new Set<string>(knowledgeFileProcessingExts)

const CHERRY_META_DIR = '.cherry'
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

export function getKnowledgeBaseDir(baseId: string): FilePath {
  return path.join(application.getPath('feature.knowledgebase.data'), baseId) as FilePath
}

/** The material root (`{baseDir}/raw`) under which every `relativePath` resolves. */
export function getKnowledgeMaterialDir(baseId: string): FilePath {
  return path.join(getKnowledgeBaseDir(baseId), MATERIAL_ROOT_DIR) as FilePath
}

export function getKnowledgeBaseMetaDir(baseId: string): FilePath {
  return path.join(getKnowledgeBaseDir(baseId), CHERRY_META_DIR) as FilePath
}

export async function getKnowledgeVectorStoreFilePath(baseId: string): Promise<FilePath> {
  const metaDir = getKnowledgeBaseMetaDir(baseId)
  await ensureDir(metaDir)
  return getKnowledgeVectorStoreFilePathSync(baseId)
}

export function getKnowledgeVectorStoreFilePathSync(baseId: string): FilePath {
  const metaDir = getKnowledgeBaseMetaDir(baseId)
  return path.join(metaDir, VECTOR_STORE_FILE) as FilePath
}

export function getKnowledgeBaseFilePath(baseId: string, relativePath: string): FilePath {
  assertSafeKnowledgeRelativePath(relativePath)
  return path.join(getKnowledgeMaterialDir(baseId), relativePath) as FilePath
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
  return probeReadable(absolutePath as FilePath)
}

export function getKnowledgeSourceRelativePath(sourcePath: string): string {
  const fileName = path.basename(sourcePath)
  assertSafeKnowledgeRelativePath(fileName)
  return fileName
}

export function toKnowledgeRelativePath(baseId: string, absolutePath: string): string {
  const materialDir = getKnowledgeMaterialDir(baseId)
  const relativePath = path.relative(materialDir, absolutePath)
  assertSafeKnowledgeRelativePath(relativePath)
  if (!isPathInsideBase(materialDir, absolutePath)) {
    throw new Error(`Path is outside knowledge base material root '${baseId}': ${absolutePath}`)
  }
  return normalizeRelativePath(relativePath)
}

export function getProcessedMarkdownRelativePath(relativePath: string): string {
  assertSafeKnowledgeRelativePath(relativePath)
  const parsed = path.parse(relativePath)
  return normalizeRelativePath(path.join(parsed.dir, `${parsed.name}.md`))
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
): string {
  const chosen = nextFreeKnowledgeRelativePath(sourceRelativePath, (candidate) => {
    if (reservedPaths.has(candidate)) {
      return false
    }
    return !reserveProcessedArtifact || !reservedPaths.has(getProcessedMarkdownRelativePath(candidate))
  })

  reservedPaths.add(chosen)
  if (reserveProcessedArtifact) {
    reservedPaths.add(getProcessedMarkdownRelativePath(chosen))
  }
  return chosen
}

export async function copyFileIntoKnowledgeBaseAt(
  baseId: string,
  sourcePath: string,
  relativePath: string
): Promise<string> {
  const destPath = getKnowledgeBaseFilePath(baseId, relativePath)
  await assertTargetAvailable(destPath)
  await ensureDir(path.dirname(destPath) as FilePath)
  await copy(sourcePath as FilePath, destPath)
  return relativePath
}

/** Write in-memory content (e.g. a captured URL snapshot) to a base-relative file. */
export async function writeFileIntoKnowledgeBaseAt(
  baseId: string,
  relativePath: string,
  content: string
): Promise<string> {
  const destPath = getKnowledgeBaseFilePath(baseId, relativePath)
  await assertTargetAvailable(destPath)
  await ensureDir(path.dirname(destPath) as FilePath)
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

export function assertSafeKnowledgeRelativePath(relativePath: string): void {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
    throw new Error(`Invalid knowledge relative path: ${relativePath}`)
  }

  const normalized = normalizeRelativePath(relativePath)
  if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
    throw new Error(`Invalid knowledge relative path: ${relativePath}`)
  }

  if (normalized.startsWith(`${CHERRY_META_DIR}/`) || normalized === CHERRY_META_DIR) {
    throw new Error(`Knowledge relative path is reserved: ${relativePath}`)
  }
}

function normalizeRelativePath(relativePath: string): string {
  return path.normalize(relativePath).replace(/\\/g, '/')
}

function isPathInsideBase(baseDir: string, candidatePath: string): boolean {
  const relativePath = path.relative(baseDir, candidatePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

async function assertTargetAvailable(destPath: FilePath): Promise<void> {
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
