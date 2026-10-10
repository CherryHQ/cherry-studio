import { Document, FileReader, type Metadata } from '@vectorstores/core'

type DraftsExportItem = {
  content?: string
  tags?: string[]
  created_at?: string
  modified_at?: string
}

export class DraftsExportReader extends FileReader<Document<Metadata>> {
  async loadDataAsContent(fileContent: Uint8Array): Promise<Document<Metadata>[]> {
    const text = new TextDecoder('utf-8').decode(fileContent)
    let rawJson: DraftsExportItem[]

    try {
      rawJson = JSON.parse(text) as DraftsExportItem[]
    } catch (error) {
      throw new Error('Failed to parse Drafts export JSON', {
        cause: error instanceof Error ? error : new Error(String(error))
      })
    }

    return rawJson
      .filter((entry) => typeof entry.content === 'string' && entry.content.trim().length > 0)
      .map(
        (entry, index) =>
          new Document({
            text: entry.content!.trim(),
            metadata: {
              draftIndex: index,
              tags: entry.tags ?? [],
              modifiedAt: entry.modified_at ?? entry.created_at
            }
          })
      )
  }
}
