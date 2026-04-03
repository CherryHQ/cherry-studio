import { getFileExt } from '@main/utils/file'
import type { FileMetadata } from '@shared/data/types/file'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { type Document, type FileReader as VectorStoreFileReader } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'
import { DocxReader } from '@vectorstores/readers/docx'
import { JSONReader } from '@vectorstores/readers/json'
import { MarkdownReader } from '@vectorstores/readers/markdown'
import { PDFReader } from '@vectorstores/readers/pdf'
import { TextFileReader } from '@vectorstores/readers/text'

import type { KnowledgeReader } from './KnowledgeReader'

type SupportedFileReader = VectorStoreFileReader<Document>

export function createSupportedFileReader(file: FileMetadata): SupportedFileReader {
  const extension = getFileExt(file.path).toLowerCase()

  switch (extension) {
    case '.pdf':
      return new PDFReader()
    case '.csv':
      return new CSVReader()
    case '.docx':
      return new DocxReader()
    case '.json':
      return new JSONReader()
    case '.md':
      return new MarkdownReader()
    default:
      return new TextFileReader()
  }
}

export class KnowledgeFileReader implements KnowledgeReader<KnowledgeItemOf<'file'>> {
  async load(item: KnowledgeItemOf<'file'>): Promise<Document[]> {
    const file = item.data.file
    if (!file.path) {
      throw new Error(`Knowledge file ${file.id} is missing file.path`)
    }

    const reader = createSupportedFileReader(file)
    return await reader.loadData(file.path)
  }
}
