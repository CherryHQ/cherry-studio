import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'

export async function loadNoteDocuments(item: KnowledgeItemOf<'note'>): Promise<Document[]> {
  const name =
    item.data.content
      .split('\n')
      .map((line) => line.trim())
      .find(Boolean) ?? ''

  return [
    new Document({
      text: item.data.content,
      metadata: {
        // TODO: Confirm the product semantics for notes without sourceUrl or visible content.
        source: item.data.sourceUrl || item.id,
        name: name || item.id
      }
    })
  ]
}
