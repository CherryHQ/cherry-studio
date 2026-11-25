import { Document, FileReader, type Metadata } from '@vectorstores/core'
import * as z from 'zod'

export class DraftsExportReader extends FileReader<Document<Metadata>> {
  async loadDataAsContent(fileContent: Uint8Array): Promise<Document<Metadata>[]> {
    const text = new TextDecoder('utf-8').decode(fileContent)
    let rawJson: unknown[]

    try {
      rawJson = z.array(z.unknown()).parse(JSON.parse(text))
    } catch (error) {
      throw new Error('Failed to parse Drafts export JSON', {
        cause: error instanceof Error ? error : new Error(String(error))
      })
    }

    const documents: Document<Metadata>[] = []

    for (const entry of rawJson) {
      if (!entry || typeof entry !== 'object' || !('content' in entry) || typeof entry.content !== 'string') {
        continue
      }

      const content = entry.content.trim()

      if (!content) continue

      const tags = 'tags' in entry ? entry.tags : undefined
      const modifiedAt = 'modified_at' in entry ? entry.modified_at : undefined
      const createdAt = 'created_at' in entry ? entry.created_at : undefined
      documents.push(
        new Document({
          text: content,
          metadata: { draftIndex: documents.length, tags: tags ?? [], modifiedAt: modifiedAt ?? createdAt }
        })
      )
    }

    return documents
  }
}
