import fs from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { loggerService } from '@logger'
import { copy, ensureDir, remove, removeDir } from '@main/utils/file/fs'
import type { FilePath } from '@shared/file/types'

const logger = loggerService.withContext('Knowledge:PathStorage')

const CHERRY_META_DIR = '.cherry'
const VECTOR_STORE_FILE = 'index.sqlite'

export function getKnowledgeBaseDir(baseId: string): FilePath {
  return path.join(application.getPath('feature.knowledgebase.data'), baseId) as FilePath
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
  return path.join(getKnowledgeBaseDir(baseId), relativePath) as FilePath
}

export function getKnowledgeSourceRelativePath(sourcePath: string): string {
  const fileName = path.basename(sourcePath)
  assertSafeKnowledgeRelativePath(fileName)
  return fileName
}

export function toKnowledgeRelativePath(baseId: string, absolutePath: string): string {
  const baseDir = getKnowledgeBaseDir(baseId)
  const relativePath = path.relative(baseDir, absolutePath)
  assertSafeKnowledgeRelativePath(relativePath)
  if (!isPathInsideBase(baseDir, absolutePath)) {
    throw new Error(`Path is outside knowledge base '${baseId}': ${absolutePath}`)
  }
  return normalizeRelativePath(relativePath)
}

export function getProcessedMarkdownRelativePath(relativePath: string): string {
  assertSafeKnowledgeRelativePath(relativePath)
  const parsed = path.parse(relativePath)
  return normalizeRelativePath(path.join(parsed.dir, `${parsed.name}.md`))
}

export async function copyFileIntoKnowledgeBase(baseId: string, sourcePath: string): Promise<string> {
  return copyFileIntoKnowledgeBaseAt(baseId, sourcePath, getKnowledgeSourceRelativePath(sourcePath))
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

export async function assertKnowledgeFileTargetAvailable(baseId: string, relativePath: string): Promise<void> {
  await assertTargetAvailable(getKnowledgeBaseFilePath(baseId, relativePath))
}

export async function deleteKnowledgeItemFiles(
  baseId: string,
  items: Array<{ type: string; data: unknown }>
): Promise<void> {
  const paths = new Set<string>()
  for (const item of items) {
    if (item.type !== 'file' || typeof item.data !== 'object' || item.data === null) {
      continue
    }
    const data = item.data as { relativePath?: unknown; indexedRelativePath?: unknown }
    if (typeof data.relativePath === 'string') paths.add(data.relativePath)
    if (typeof data.indexedRelativePath === 'string') paths.add(data.indexedRelativePath)
  }

  await Promise.all([...paths].map((relativePath) => remove(getKnowledgeBaseFilePath(baseId, relativePath))))
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

function assertSafeKnowledgeRelativePath(relativePath: string): void {
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
