import type { FileMetadata } from '@renderer/types'
import { type FileEntryId } from '@shared/data/types/file'
import { FilePathSchema } from '@shared/file/types'

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

  const parsed = FilePathSchema.safeParse(source)
  if (!parsed.success) {
    throw new Error(`Failed to resolve an absolute local path for "${displayName}"`)
  }

  // Use the canonical (NFC + resolved + trailing-stripped) value, not the raw
  // input: the persisted `source` must match the canonical `entry.externalPath`
  // so later equality/dedup checks don't diverge on NFD macOS paths.
  const entry = await window.api.file.ensureExternalEntry({ externalPath: parsed.data })

  return {
    source: parsed.data,
    fileEntryId: entry.id
  }
}

export const resolveKnowledgeFileMetadataEntryData = async (file: FileMetadata): Promise<KnowledgeFileItemData> =>
  resolveKnowledgeFileEntryData(file.path, file.origin_name || file.name)
