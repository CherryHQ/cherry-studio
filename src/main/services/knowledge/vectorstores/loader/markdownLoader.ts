import { loggerService } from '@logger'
import type { FileMetadata } from '@types'
import type { Document, Metadata } from '@vectorstores/core'
import { MarkdownReader } from '@vectorstores/readers/markdown'

const logger = loggerService.withContext('VectorstoresMarkdownLoader')

export type MarkdownDocumentMetadata = Metadata & {
  source: string
  type: 'markdown'
}

export const loadMarkdownDocuments = async (file: FileMetadata): Promise<Array<Document<MarkdownDocumentMetadata>>> => {
  const reader = new MarkdownReader()
  const documents = await reader.loadData(file.path)

  const normalized = documents
    .map((doc) => {
      doc.metadata = {
        ...doc.metadata,
        source: file.path,
        type: 'markdown'
      }
      return doc as Document<MarkdownDocumentMetadata>
    })
    .filter((doc) => doc.getText().trim().length > 0)

  if (normalized.length === 0) {
    logger.warn(`Empty markdown file: ${file.path}`)
  }

  return normalized
}
