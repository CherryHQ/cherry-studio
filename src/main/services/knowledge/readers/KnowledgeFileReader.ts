import { application } from '@application'
import { toFileInfo } from '@main/services/file'
import type { FileEntry } from '@shared/data/types/file'
import {
  isSupportedKnowledgeFileExt,
  type KnowledgeItemOf,
  type KnowledgeSourceMetadata
} from '@shared/data/types/knowledge'
import { Document, type FileReader as VectorStoreFileReader } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'
import { DocxReader } from '@vectorstores/readers/docx'
import { JSONReader } from '@vectorstores/readers/json'
import { MarkdownReader } from '@vectorstores/readers/markdown'
import { PDFReader } from '@vectorstores/readers/pdf'
import { TextFileReader } from '@vectorstores/readers/text'

import { SOURCE_FILE_MISSING_ERROR } from '../utils/errors'
import { DraftsExportReader } from './files/DraftsExportReader'
import { EpubReader } from './files/EpubReader'

export function createSupportedFileReader(file: Pick<FileEntry, 'ext'>): VectorStoreFileReader<Document> {
  const ext = file.ext?.trim().replace(/^\./, '').toLowerCase() ?? ''

  if (!isSupportedKnowledgeFileExt(ext)) {
    throw new Error(`Unsupported knowledge file type: ${file.ext ?? ''}`)
  }

  switch (ext) {
    case 'pdf':
      return new PDFReader()
    case 'csv':
      return new CSVReader()
    case 'docx':
      return new DocxReader()
    case 'epub':
      return new EpubReader()
    case 'json':
      return new JSONReader()
    case 'md':
    case 'markdown':
      return new MarkdownReader()
    case 'draftsexport':
      return new DraftsExportReader()
    default:
      return new TextFileReader()
  }
}

export async function loadFileDocuments(item: KnowledgeItemOf<'file'>): Promise<Document[]> {
  const fileManager = application.get('FileManager')
  const entry = await fileManager.getById(item.data.fileEntryId)
  const danglingState = await fileManager.getDanglingState({ id: item.data.fileEntryId })
  if (danglingState === 'missing') {
    throw new Error(SOURCE_FILE_MISSING_ERROR)
  }
  try {
    const fileInfo = await toFileInfo(entry)
    const reader = createSupportedFileReader(entry)
    const documents = await reader.loadData(fileInfo.path)
    return mapDocumentsToKnowledgeSource(item, documents)
  } catch (error) {
    if (isSourceFileMissingError(error)) {
      throw new Error(SOURCE_FILE_MISSING_ERROR)
    }
    throw error
  }
}

function mapDocumentsToKnowledgeSource(item: KnowledgeItemOf<'file'>, documents: Document[]): Document[] {
  const sourceMetadata: KnowledgeSourceMetadata = {
    source: item.data.source
  }

  return documents.map(
    (document) =>
      new Document({
        text: document.text,
        metadata: { ...sourceMetadata }
      })
  )
}

function isSourceFileMissingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}
