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

  for (const itemId of uniqueItemIds) {
    await vectorStore.replaceByExternalId(itemId, [])
  }
}
