import { externalKnowledgeDocumentService } from '@data/services/ExternalKnowledgeDocumentService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

import { isIndexableKnowledgeItem } from '../items'
import { deleteKnowledgeItemFiles, deleteKnowledgeItemFilesBestEffort } from '../pathStorage'
import { deleteKnowledgeItemVectors } from '../pipeline/vectorstore/vectorCleanup'

export function assertNoActiveExternalOwner(itemIds: readonly string[], operation: string): void {
  const ownedItemIds = externalKnowledgeDocumentService.getActiveOwnedKnowledgeItemIds(itemIds)
  if (ownedItemIds.size > 0) {
    throw DataApiErrorFactory.invalidOperation(
      operation,
      `Cannot purge ${ownedItemIds.size} external knowledge item(s) managed by an active document owner`
    )
  }
}

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
  assertNoActiveExternalOwner(subtreeItemIds, 'purge knowledge subtree')
  const leafItemIds = subtreeItems.filter((item) => isIndexableKnowledgeItem(item)).map((item) => item.id)

  // Vector cleanup precedes DB deletion so a retry can still discover affected item ids.
  await deleteKnowledgeItemVectors(base, leafItemIds)
  const externalItems = subtreeItems.filter((item) => item.type === 'external')
  const ordinaryItems = subtreeItems.filter((item) => item.type !== 'external')
  if (externalItems.length > 0) {
    await deleteKnowledgeItemFiles(base.id, externalItems)
  }
  if (ordinaryItems.length > 0) {
    await deleteKnowledgeItemFilesBestEffort(base.id, ordinaryItems, logContext)
  }

  knowledgeItemService.deleteItemsByIds(base.id, subtreeItemIds)
}
