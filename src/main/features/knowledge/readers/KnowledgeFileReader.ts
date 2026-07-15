import { getFileExt } from '@main/utils/legacyFile'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'
import type { FilePath } from '@shared/types/file'
import type { Document, FileReader as VectorStoreFileReader } from '@vectorstores/core'

import { getKnowledgeBaseFilePath } from '../utils/storage/pathStorage'

export async function createSupportedFileReader(filePath: FilePath): Promise<VectorStoreFileReader<Document>> {
  const extension = getFileExt(filePath).toLowerCase()

  switch (extension) {
    case '.pdf': {
      const { PDFReader } = await import('@vectorstores/readers/pdf')
      return new PDFReader()
    }
    case '.csv': {
      const { CSVReader } = await import('@vectorstores/readers/csv')
      return new CSVReader()
    }
    case '.docx': {
      const { DocxReader } = await import('@vectorstores/readers/docx')
      return new DocxReader()
    }
    case '.epub': {
      const { EpubReader } = await import('./files/EpubReader')
      return new EpubReader()
    }
    case '.html':
    case '.htm': {
      const { HTMLReader } = await import('@vectorstores/readers/html')
      return new HTMLReader()
    }
    case '.json': {
      const { JSONReader } = await import('@vectorstores/readers/json')
      return new JSONReader()
    }
    case '.markdown':
    case '.md':
    case '.mdx': {
      const { MarkdownReader } = await import('@vectorstores/readers/markdown')
      return new MarkdownReader()
    }
    case '.draftsexport': {
      const { DraftsExportReader } = await import('./files/DraftsExportReader')
      return new DraftsExportReader()
    }
    default: {
      const { TextFileReader } = await import('@vectorstores/readers/text')
      return new TextFileReader()
    }
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

  const [{ Document }, reader] = await Promise.all([import('@vectorstores/core'), createSupportedFileReader(filePath)])
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
