import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

export type LiveKnowledgeItemSkipReason = 'missing' | 'deleting'
export type LiveKnowledgeItemResult = { item: KnowledgeItem } | { skip: LiveKnowledgeItemSkipReason }

/** Classify a single item: found and live, or a skip (`item.status === 'deleting'`, or the row is NOT_FOUND). Does not check the base. */
export function resolveLiveKnowledgeItem(itemId: string): LiveKnowledgeItemResult {
  try {
    const item = knowledgeItemService.getById(itemId)
    if (item.status === 'deleting') {
      return { skip: 'deleting' }
    }
    return { item }
  } catch (error) {
    if (isDataApiNotFoundError(error)) {
      return { skip: 'missing' }
    }
    throw error
  }
}

export type LiveKnowledgeSubtreeResult = { items: KnowledgeItem[] } | { skip: 'deleting' }

/** Classify a resolved subtree (roots + descendants): live, or a skip if any member is deleting. */
export function resolveLiveKnowledgeSubtree(baseId: string, rootItemIds: string[]): LiveKnowledgeSubtreeResult {
  const items = knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
  if (items.some((item) => item.status === 'deleting')) {
    return { skip: 'deleting' }
  }
  return { items }
}
