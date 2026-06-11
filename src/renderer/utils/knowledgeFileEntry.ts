import type { FileMetadata } from '@renderer/types'
import { AbsolutePathSchema } from '@shared/data/types/file'

export interface KnowledgeFileItemData {
  source: string
  path: string
}

export const resolveKnowledgeFileData = async (
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

  return {
    source,
    path: source
  }
}

export const resolveKnowledgeFileMetadataEntryData = async (file: FileMetadata): Promise<KnowledgeFileItemData> =>
  resolveKnowledgeFileData(file.path, file.origin_name || file.name)
