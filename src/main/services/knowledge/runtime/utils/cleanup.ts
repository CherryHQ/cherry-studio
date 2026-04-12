import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KnowledgeBase, KnowledgeItem } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('KnowledgeRuntimeCleanup')

interface DeleteItemVectorFailure {
  itemId: string
  error: Error
}

class DeleteItemVectorsError extends Error {
  constructor(
    readonly baseId: string,
    readonly succeededItemIds: string[],
    readonly failed: DeleteItemVectorFailure[]
  ) {
    super(
      `Failed to delete vectors for knowledge items in base ${baseId}: ${failed.map((entry) => entry.itemId).join(', ')}`
    )
    this.name = 'DeleteItemVectorsError'
  }
}

/**
 * Deletes vectors for the given item ids within one knowledge base.
 */
export async function deleteItemVectors(base: KnowledgeBase, itemIds: string[]): Promise<void> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return
  }

  const vectorStoreService = application.get('KnowledgeVectorStoreService')
  const vectorStore = await vectorStoreService.getStoreIfExists(base)
  if (!vectorStore) {
    return
  }

  const results = await Promise.allSettled(uniqueItemIds.map((itemId) => vectorStore.delete(itemId)))
  const succeededItemIds: string[] = []
  const failed: DeleteItemVectorFailure[] = []

  for (const [index, result] of results.entries()) {
    const itemId = uniqueItemIds[index]
    if (result.status === 'fulfilled') {
      succeededItemIds.push(itemId)
      continue
    }

    failed.push({
      itemId,
      error: result.reason instanceof Error ? result.reason : new Error(String(result.reason))
    })
  }

  if (failed.length > 0) {
    throw new DeleteItemVectorsError(base.id, succeededItemIds, failed)
  }
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

      const deleteError = error instanceof DeleteItemVectorsError ? error : null
      logger.warn('Failed to delete knowledge item vectors during interruption cleanup', {
        baseId: base.id,
        itemIds: [...itemIds],
        succeededItemIds: deleteError?.succeededItemIds ?? [],
        failedItemIds: deleteError?.failed.map((entry) => entry.itemId) ?? [],
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
