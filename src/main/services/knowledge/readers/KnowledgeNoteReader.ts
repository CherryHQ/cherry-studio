import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document } from '@vectorstores/core'

import type { KnowledgeReader } from './KnowledgeReader'

export class KnowledgeNoteReader implements KnowledgeReader<KnowledgeItemOf<'note'>> {
  async load(item: KnowledgeItemOf<'note'>): Promise<Document[]> {
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
}
