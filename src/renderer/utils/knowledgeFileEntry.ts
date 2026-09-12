import { ipcApi } from '@renderer/ipc'
import type { FileMetadata } from '@renderer/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import { createFilePathHandle } from '@shared/utils/file'

export interface KnowledgeFileItemData {
  source: string
  path: AbsoluteFilePath
}

/** Expected resolve failure (bad path or missing/non-file). IPC probe throws must not use this. */
export class KnowledgeFileResolveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeFileResolveError'
  }
}

export class MissingKnowledgeFileError extends KnowledgeFileResolveError {
  constructor(displayName: string) {
    super(`Failed to read a local file for "${displayName}"`)
    this.name = 'MissingKnowledgeFileError'
  }
}

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

  const metadata = await ipcApi.request('file.get_metadata', createFilePathHandle(result.data))
  if (metadata === null || metadata.kind !== 'file') {
    throw new MissingKnowledgeFileError(displayName)
  }

  return {
    source,
    path: result.data
  }
}

export const resolveKnowledgeFileMetadataEntryData = async (file: FileMetadata): Promise<KnowledgeFileItemData> =>
  resolveKnowledgeFileData(file.path, file.origin_name || file.name)
