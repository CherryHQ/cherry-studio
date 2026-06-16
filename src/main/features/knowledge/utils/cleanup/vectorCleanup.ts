import { application } from '@application'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

export async function deleteKnowledgeItemVectors(base: KnowledgeBase, itemIds: string[]): Promise<void> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return
  }

  const vectorStoreService = application.get('KnowledgeVectorStoreService')
  const store = await vectorStoreService.getIndexStoreIfExists(base)
  if (!store) {
    return
  }

  const results = await Promise.allSettled(uniqueItemIds.map((itemId) => store.deleteMaterial(itemId)))
  // Carry each root cause into the aggregate error — an id-only list would leave
  // nothing to diagnose the individual deletions with.
  const failures = uniqueItemIds.flatMap((itemId, index) => {
    const result = results[index]
    return result?.status === 'rejected' ? [{ itemId, reason: result.reason }] : []
  })
  if (failures.length > 0) {
    const details = failures
      .map(({ itemId, reason }) => `${itemId} (${reason instanceof Error ? reason.message : String(reason)})`)
      .join(', ')
    throw new Error(`Failed to delete knowledge item vectors for item ids: ${details}`)
  }
}
