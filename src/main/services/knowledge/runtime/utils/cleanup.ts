import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('KnowledgeRuntimeCleanup')

/**
 * Deletes vectors for the given item ids within one knowledge base.
 */
export async function deleteItemVectors(base: KnowledgeBase, itemIds: string[]): Promise<void> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return
  }

  const vectorStoreService = application.get('KnowledgeVectorStoreService')
  const vectorStore = await vectorStoreService.createStore(base)
  await Promise.all(uniqueItemIds.map((itemId) => vectorStore.delete(itemId)))
}

/**
 * Groups interrupted entries by base and deletes their vectors in batches.
 */
export async function deleteVectorsForEntries(
  entries: Array<{ base: KnowledgeBase; item: KnowledgeItem }>,
  options: { continueOnError: boolean }
): Promise<void> {
  const entriesByBase = new Map<string, { base: KnowledgeBase; itemIds: Set<string> }>()

  for (const entry of entries) {
    const existing = entriesByBase.get(entry.base.id)
    if (existing) {
      existing.itemIds.add(entry.item.id)
      continue
    }

    entriesByBase.set(entry.base.id, {
      base: entry.base,
      itemIds: new Set([entry.item.id])
    })
  }

  for (const { base, itemIds } of entriesByBase.values()) {
    try {
      await deleteItemVectors(base, [...itemIds])
    } catch (error) {
      if (!options.continueOnError) {
        throw error
      }

      logger.warn('Failed to delete knowledge item vectors during interruption cleanup', {
        baseId: base.id,
        itemIds: [...itemIds],
        cleanupError: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

/**
 * Marks interrupted items as failed and logs any persistence errors.
 */
export async function failItems(itemIds: string[], reason: string): Promise<void> {
  if (itemIds.length === 0) {
    return
  }

  const uniqueItemIds = [...new Set(itemIds)]
  const results = await Promise.allSettled(
    uniqueItemIds.map((itemId) =>
      knowledgeItemService.update(itemId, {
        status: 'failed',
        error: reason
      })
    )
  )

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      continue
    }

    logger.error(
      'Failed to persist interrupted knowledge item state',
      result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
      {
        itemId: uniqueItemIds[index],
        reason
      }
    )
  }
}
