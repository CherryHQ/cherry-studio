import type { KnowledgeItem } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

export interface KnowledgeReader<TItem extends KnowledgeItem = KnowledgeItem> {
  load(item: TItem): Promise<Document[]>
}
