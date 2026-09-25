import { ipcApi } from '@renderer/ipc'
import type { FileMetadata } from '@renderer/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

export interface KnowledgeFileItemData {
  source: string
  path: AbsoluteFilePath
}

export interface KnowledgeFileResolveFailure {
  index: number
  source: string | undefined
  reason: string
  error: unknown
}

export interface KnowledgeFileBatchResult {
  resolved: KnowledgeFileItemData[]
  skipped: KnowledgeFileResolveFailure[]
  failed: KnowledgeFileResolveFailure[]
}

/** Expected resolve failure (bad path or missing/non-file). IPC probe throws must not use this. */
export class KnowledgeFileResolveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeFileResolveError'
  }
}

export class MissingKnowledgeFileError extends KnowledgeFileResolveError {
  readonly path: string

  constructor(path: string, displayName: string) {
    super(`Failed to read a local file for "${displayName}" (${path})`)
    this.name = 'MissingKnowledgeFileError'
    this.path = path
  }
}

export class KnowledgeFileNotAFileError extends KnowledgeFileResolveError {
  readonly path: string

  constructor(path: string, displayName: string) {
    super(`Path for "${displayName}" is not a file (${path})`)
    this.name = 'KnowledgeFileNotAFileError'
    this.path = path
  }
}

const describeFailure = (index: number, source: string | undefined, error: unknown): KnowledgeFileResolveFailure => ({
  index,
  source,
  reason: error instanceof Error ? error.message : String(error),
  error
})

/** Expected missing/bad-path/not-a-file, plus per-entry TypeError from malformed payloads. */
export const isSkippableKnowledgeFileError = (error: unknown): boolean =>
  error instanceof KnowledgeFileResolveError || error instanceof TypeError

export const resolveKnowledgeFileData = async (
  externalPath: string,
  displayName = externalPath
): Promise<KnowledgeFileItemData> => {
  const source = externalPath.trim()

  if (!source) {
    throw new KnowledgeFileResolveError(`Failed to resolve a local path for "${displayName}"`)
  }

  const result = AbsoluteFilePathSchema.safeParse(source)
  if (!result.success) {
    throw new KnowledgeFileResolveError(`Failed to resolve an absolute local path for "${displayName}"`)
  }

  // file.get_metadata maps ENOENT, EACCES, and other stat failures to null; errno is not exposed.
  const metadata = await ipcApi.request('file.get_metadata', createFilePathHandle(result.data))
  if (metadata == null) {
    throw new MissingKnowledgeFileError(result.data, displayName)
  }
  if (metadata.kind !== 'file') {
    throw new KnowledgeFileNotAFileError(result.data, displayName)
  }

  return {
    source,
    path: result.data
  }
}

export const resolveKnowledgeFileMetadataEntryData = async (file: FileMetadata): Promise<KnowledgeFileItemData> =>
  resolveKnowledgeFileData(file.path, file.origin_name || file.name)

export const resolveFileEntryDataFromFile = (file: File): Promise<KnowledgeFileItemData> => {
  const filePath = window.api.file.getPathForFile(file)

  if (!filePath) {
    return Promise.reject(new KnowledgeFileResolveError(`Failed to resolve a local path for "${file.name}"`))
  }

  return resolveKnowledgeFileData(filePath, file.name)
}

export const resolveKnowledgeFileBatch = async <T>(
  items: T[],
  resolveItem: (item: T) => Promise<KnowledgeFileItemData>,
  describeItem: (item: T) => string | undefined
): Promise<KnowledgeFileBatchResult> => {
  const results = await Promise.allSettled(items.map(resolveItem))
  const resolved: KnowledgeFileItemData[] = []
  const skipped: KnowledgeFileResolveFailure[] = []
  const failed: KnowledgeFileResolveFailure[] = []

  results.forEach((item, index) => {
    if (item.status === 'fulfilled') {
      resolved.push(item.value)
      return
    }
    const failure = describeFailure(index, describeItem(items[index]), item.reason)
    if (isSkippableKnowledgeFileError(item.reason)) {
      skipped.push(failure)
    } else {
      failed.push(failure)
    }
  })

  return { resolved, skipped, failed }
}

/** Skip expected missing/malformed files. Unexpected IPC/transport failures stay fatal. */
export const selectKnowledgeFileBatchOutcome = (
  batch: KnowledgeFileBatchResult
): { resolved: KnowledgeFileItemData[]; skipped: KnowledgeFileResolveFailure[]; fatal?: unknown } => {
  if (batch.failed.length > 0) {
    return { resolved: [], skipped: batch.skipped, fatal: batch.failed[0].error }
  }
  return { resolved: batch.resolved, skipped: batch.skipped }
}
