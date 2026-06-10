import type { KnowledgeItem } from '@shared/data/types/knowledge'

import type { ContainerKnowledgeItem, IndexableKnowledgeItem } from '../types/items'

export function isIndexableKnowledgeItem(item: KnowledgeItem): item is IndexableKnowledgeItem {
  return item.type === 'file' || item.type === 'url' || item.type === 'note'
}

export function filterIndexableKnowledgeItems(items: KnowledgeItem[]): IndexableKnowledgeItem[] {
  return items.filter(isIndexableKnowledgeItem)
}

export function isContainerKnowledgeItem(item: KnowledgeItem): item is ContainerKnowledgeItem {
  return item.type === 'directory'
}
