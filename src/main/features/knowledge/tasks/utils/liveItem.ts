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

/** The selected roots that still exist and are not deleting. A delete owns only the roots it marked. */
export function resolveLiveKnowledgeRoots(baseId: string, rootItemIds: string[]): KnowledgeItem[] {
  return knowledgeItemService
    .getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
    .filter((item) => rootItemIds.includes(item.id) && item.status !== 'deleting')
}
