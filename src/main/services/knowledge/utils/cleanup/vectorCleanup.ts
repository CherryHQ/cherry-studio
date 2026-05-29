import { application } from '@application'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

export async function deleteKnowledgeItemVectors(base: KnowledgeBase, itemIds: string[]): Promise<void> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return
  }

  const vectorStoreService = application.get('KnowledgeVectorStoreService')
  const vectorStore = await vectorStoreService.getStoreIfExists(base)
  if (!vectorStore) {
    return
  }

  const results = await Promise.allSettled(uniqueItemIds.map((itemId) => vectorStore.replaceByExternalId(itemId, [])))
  const failedItemIds = uniqueItemIds.filter((_, index) => results[index]?.status === 'rejected')
  if (failedItemIds.length > 0) {
    throw new Error(`Failed to delete knowledge item vectors for item ids: ${failedItemIds.join(', ')}`)
  }
}
