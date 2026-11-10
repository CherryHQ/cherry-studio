import type { KnowledgeItemSort, KnowledgeItemSortBy } from '@shared/data/api/schemas/knowledges'

export function nextKnowledgeItemSort(
  current: KnowledgeItemSort | null,
  sortBy: KnowledgeItemSortBy
): KnowledgeItemSort | null {
  const firstOrder = sortBy === 'updatedAt' ? 'desc' : 'asc'
  if (current?.sortBy !== sortBy) return { sortBy, sortOrder: firstOrder }
  if (current.sortOrder !== firstOrder) return null
  return { sortBy, sortOrder: firstOrder === 'asc' ? 'desc' : 'asc' }
}
