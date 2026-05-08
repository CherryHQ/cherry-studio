import type { KnowledgeItem } from '@shared/data/types/knowledge'

import type { IndexableKnowledgeItem } from '../types/items'

export function isIndexableKnowledgeItem(item: KnowledgeItem): item is IndexableKnowledgeItem {
  return item.type === 'file' || item.type === 'url' || item.type === 'note'
}

export function filterIndexableKnowledgeItems(items: KnowledgeItem[]): IndexableKnowledgeItem[] {
  return items.filter(isIndexableKnowledgeItem)
}
