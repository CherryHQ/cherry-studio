import type { KnowledgeV2Item } from '../types'

const isLegacyContainerChild = (item: KnowledgeV2Item, itemsById: ReadonlyMap<string, KnowledgeV2Item>) => {
  if (!item.groupId) {
    return false
  }

  const owner = itemsById.get(item.groupId)
  if (!owner) {
    return false
  }

  return (owner.type === 'directory' && item.type === 'file') || (owner.type === 'sitemap' && item.type === 'url')
}

export const filterKnowledgeV2TopLevelItems = (items: ReadonlyArray<KnowledgeV2Item>): KnowledgeV2Item[] => {
  const itemsById = new Map(items.map((item) => [item.id, item] as const))

  return items.filter((item) => item.parentId == null && !isLegacyContainerChild(item, itemsById))
}
