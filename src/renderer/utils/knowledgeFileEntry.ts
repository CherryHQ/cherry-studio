import type { FileMetadata } from '@renderer/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

export interface KnowledgeFileItemData {
  source: string
  path: AbsoluteFilePath
  // Set when the user picked a file whose extension is outside the curated allow-list via the
  // "All files" option. Carried to main so the add-time gate lets it through; the index-time
  // binary guard still rejects a file that decodes as binary.
  allowArbitrary?: boolean
}

export const resolveKnowledgeFileData = async (
  externalPath: string,
  displayName = externalPath,
  allowArbitrary = false
): Promise<KnowledgeFileItemData> => {
  const source = externalPath.trim()

  if (!source) {
    throw new Error(`Failed to resolve a local path for "${displayName}"`)
  }

  const result = AbsoluteFilePathSchema.safeParse(source)
  if (!result.success) {
    throw new Error(`Failed to resolve an absolute local path for "${displayName}"`)
  }

  return {
    source,
    path: result.data,
    ...(allowArbitrary ? { allowArbitrary: true } : {})
  }
}

export const resolveKnowledgeFileMetadataEntryData = async (
  file: FileMetadata,
  allowArbitrary = false
): Promise<KnowledgeFileItemData> => resolveKnowledgeFileData(file.path, file.origin_name || file.name, allowArbitrary)
