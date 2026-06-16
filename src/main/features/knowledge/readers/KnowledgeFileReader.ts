import { getFileExt } from '@main/utils/file'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'
import type { FilePath } from '@shared/file/types'
import { Document, type FileReader as VectorStoreFileReader } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'
import { DocxReader } from '@vectorstores/readers/docx'
import { HTMLReader } from '@vectorstores/readers/html'
import { JSONReader } from '@vectorstores/readers/json'
import { MarkdownReader } from '@vectorstores/readers/markdown'
import { PDFReader } from '@vectorstores/readers/pdf'
import { TextFileReader } from '@vectorstores/readers/text'

import { getKnowledgeBaseFilePath } from '../utils/storage/pathStorage'
import { DraftsExportReader } from './files/DraftsExportReader'
import { EpubReader } from './files/EpubReader'

export function createSupportedFileReader(filePath: FilePath): VectorStoreFileReader<Document> {
  const extension = getFileExt(filePath).toLowerCase()

  switch (extension) {
    case '.pdf':
      return new PDFReader()
    case '.csv':
      return new CSVReader()
    case '.docx':
      return new DocxReader()
    case '.epub':
      return new EpubReader()
    case '.html':
    case '.htm':
      return new HTMLReader()
    case '.json':
      return new JSONReader()
    case '.markdown':
    case '.md':
    case '.mdx':
      return new MarkdownReader()
    case '.draftsexport':
      return new DraftsExportReader()
    default:
      return new TextFileReader()
  }
}

/**
 * Read a base-relative file with the extension's reader and tag every document
 * with `source`.
 */
export async function loadDocumentsFromKnowledgeBaseFile(
  baseId: string,
  relativePath: string,
  source: string
): Promise<Document[]> {
  const filePath = getKnowledgeBaseFilePath(baseId, relativePath)

  const reader = createSupportedFileReader(filePath)
  const documents = await reader.loadData(filePath)
  const sourceMetadata: KnowledgeSourceMetadata = { source }

  return documents.map(
    (document) =>
      new Document({
        text: document.text,
        metadata: { ...sourceMetadata }
      })
  )
}

export async function loadFileDocuments(item: KnowledgeItemOf<'file'>): Promise<Document[]> {
  return loadDocumentsFromKnowledgeBaseFile(
    item.baseId,
    item.data.indexedRelativePath ?? item.data.relativePath,
    item.data.source
  )
}
