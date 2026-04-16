import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'

export async function loadNoteDocuments(item: KnowledgeItemOf<'note'>): Promise<Document[]> {
  return [
    new Document({
      text: item.data.content,
      metadata: {
        itemId: item.id,
        itemType: item.type,
        sourceUrl: item.data.sourceUrl
      }
    })
  ]
}
