import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'

export async function loadNoteDocuments(item: KnowledgeItemOf<'note'>): Promise<Document[]> {
  return [
    new Document({
      text: item.data.content,
      metadata: {
        source: item.data.source
      }
    })
  ]
}
