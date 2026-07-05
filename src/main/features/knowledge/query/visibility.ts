import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { toMaterialRelativePath } from '../items'
import { isDataApiNotFoundError } from '../tasks/utils/settled'

const logger = loggerService.withContext('Knowledge:Query')

/**
 * Concept ID (relative path, OKF §2) of a search hit's source document, or
 * undefined when it has none: a directory (no material), or a url/note whose
 * snapshot relativePath was not captured yet. A completed leaf normally has one,
 * so this only swallows the rare unindexed-snapshot case rather than throwing
 * out of the whole search.
 */
export function deriveConceptId(item: KnowledgeItem): string | undefined {
  if (item.type === 'directory') {
    return undefined
  }
  try {
    return toMaterialRelativePath(item)
  } catch (error) {
    // A completed url/note with no snapshot relativePath is an invariant violation. Swallow it (one
    // unfollowable hit must not sink the whole search) but leave a diagnostic trail rather than a silent drop.
    logger.warn('deriveConceptId: completed item has no material relativePath', {
      itemId: item.id,
      type: item.type,
      error: error instanceof Error ? error.message : String(error)
    })
    return undefined
  }
}

/** Fetch the distinct items behind the matches, keeping only those visible in this base (same base, completed). */
export function loadVisibleItems(baseId: string, materialIds: string[]): Map<string, KnowledgeItem> {
  const uniqueIds = [...new Set(materialIds)]
  const visibleItems = new Map<string, KnowledgeItem>()

  for (const materialId of uniqueIds) {
    try {
      const item = knowledgeItemService.getById(materialId)
      if (item.baseId === baseId && item.status === 'completed') {
        visibleItems.set(materialId, item)
      }
    } catch (error) {
      if (isDataApiNotFoundError(error)) {
        continue
      }
      throw error
    }
  }

  return visibleItems
}
