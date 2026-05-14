import path from 'node:path'

import { application } from '@application'
import { DataApiErrorFactory } from '@shared/data/api'
import type { ExternalFileEntry } from '@shared/data/types/file'
import { isSupportedKnowledgeFileExt } from '@shared/data/types/knowledge'
import type { FilePath } from '@shared/file/types'

export const KNOWLEDGE_UNSUPPORTED_FILE_TYPE_ERROR = 'Only text and document files are supported in knowledge bases'

export async function ensureKnowledgeExternalFileEntry(path: string): Promise<ExternalFileEntry> {
  const fileManager = application.get('FileManager')
  const entry = await fileManager.ensureExternalEntry({ externalPath: path as FilePath })
  if (entry.origin !== 'external') {
    throw new Error(`Expected external file entry for knowledge source path: ${path}`)
  }
  return entry
}

export async function normalizeKnowledgeFileData(data: { source: string; path: string }) {
  if (!isSupportedKnowledgeFileExt(path.extname(data.path))) {
    throw DataApiErrorFactory.validation(
      { path: [KNOWLEDGE_UNSUPPORTED_FILE_TYPE_ERROR] },
      KNOWLEDGE_UNSUPPORTED_FILE_TYPE_ERROR
    )
  }

  const entry = await ensureKnowledgeExternalFileEntry(data.path)

  return {
    source: data.source,
    fileEntryId: entry.id
  }
}
