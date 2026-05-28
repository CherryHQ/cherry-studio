import { application } from '@application'
import { getFileExt } from '@main/utils/file'
import type { FileEntryId } from '@shared/data/types/file'
import type { KnowledgeItemOf, KnowledgeSourceMetadata } from '@shared/data/types/knowledge'
import type { FilePath } from '@shared/file/types'
import { Document, type FileReader as VectorStoreFileReader } from '@vectorstores/core'
import { CSVReader } from '@vectorstores/readers/csv'
import { DocxReader } from '@vectorstores/readers/docx'
import { JSONReader } from '@vectorstores/readers/json'
import { MarkdownReader } from '@vectorstores/readers/markdown'
import { PDFReader } from '@vectorstores/readers/pdf'
import { TextFileReader } from '@vectorstores/readers/text'

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
    case '.json':
      return new JSONReader()
    case '.md':
      return new MarkdownReader()
    case '.draftsexport':
      return new DraftsExportReader()
    default:
      return new TextFileReader()
  }
}

export async function loadFileDocuments(
  item: KnowledgeItemOf<'file'>,
  fileEntryId: FileEntryId = item.data.fileEntryId
): Promise<Document[]> {
  const fileManager = application.get('FileManager')
  const filePath = await fileManager.getPhysicalPath(fileEntryId)

  const reader = createSupportedFileReader(filePath)
  const documents = await reader.loadData(filePath)
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
