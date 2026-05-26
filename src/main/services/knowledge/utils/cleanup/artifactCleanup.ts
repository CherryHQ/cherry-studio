import { fileRefService } from '@data/services/FileRefService'

export async function detachKnowledgeItemFileRefs(itemIds: string[]): Promise<number> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return 0
  }

  return await fileRefService.cleanupBySourceBatch('knowledge_item', uniqueItemIds)
}
