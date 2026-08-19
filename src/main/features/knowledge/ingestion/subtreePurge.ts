import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

import { isIndexableKnowledgeItem } from '../items'
import { deleteKnowledgeItemFilesBestEffort } from '../pathStorage'
import { deleteKnowledgeItemVectors } from '../pipeline/vectorstore/vectorCleanup'

/**
 * Remove a resolved subtree's vectors, on-disk files, and DB rows, in that order.
 * MUST run INSIDE the base mutation lock so no indexer can write vectors for the
 * rows being removed, and so a caller (e.g. replace-on-add) can purge and then
 * recreate within one lock acquisition — keeping the freed name available to the
 * incoming source. Callers resolve and filter `subtreeItems` themselves (the
 * delete job keeps only `deleting` rows; replace passes the conflicting roots'
 * subtrees), then run vector cleanup before DB deletion so a retry can still
 * discover affected ids.
 */
export async function purgeKnowledgeSubtreeWithinLock(
  base: KnowledgeBase,
  subtreeItems: KnowledgeItem[],
  logContext: Record<string, unknown>
): Promise<void> {
  const subtreeItemIds = subtreeItems.map((item) => item.id)
  if (subtreeItemIds.length === 0) {
    return
  }
  const leafItemIds = subtreeItems.filter((item) => isIndexableKnowledgeItem(item)).map((item) => item.id)

  // Vector cleanup precedes DB deletion so a retry can still discover affected item ids.
  await deleteKnowledgeItemVectors(base, leafItemIds)
  // Best-effort: a file-removal failure must not abort the row deletion below,
  // which would otherwise strand rows after their vectors are gone.
  await deleteKnowledgeItemFilesBestEffort(base.id, subtreeItems, logContext)

  knowledgeItemService.deleteItemsByIds(base.id, subtreeItemIds)
}
