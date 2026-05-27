import type { FileMetadata } from '@renderer/types'
import { AbsolutePathSchema, type FileEntryId } from '@shared/data/types/file'
import type { FilePath } from '@shared/file/types'

export interface KnowledgeFileItemData {
  source: string
  fileEntryId: FileEntryId
}

export const resolveKnowledgeFileEntryData = async (
  externalPath: string,
  displayName = externalPath
): Promise<KnowledgeFileItemData> => {
  const source = externalPath.trim()

  if (!source) {
    throw new Error(`Failed to resolve a local path for "${displayName}"`)
  }

  if (!AbsolutePathSchema.safeParse(source).success) {
    throw new Error(`Failed to resolve an absolute local path for "${displayName}"`)
  }

  const entry = await window.api.file.ensureExternalEntry({ externalPath: source as FilePath })

  return {
    source,
    fileEntryId: entry.id
  }
}

export const resolveKnowledgeFileMetadataEntryData = async (file: FileMetadata): Promise<KnowledgeFileItemData> =>
  resolveKnowledgeFileEntryData(file.path, file.origin_name || file.name)
