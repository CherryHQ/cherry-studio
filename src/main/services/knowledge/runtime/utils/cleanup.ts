import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

const logger = loggerService.withContext('KnowledgeRuntimeCleanup')

class DeleteItemVectorsError extends Error {
  constructor(
    readonly baseId: string,
    readonly failedItemIds: string[]
  ) {
    super(`Failed to delete vectors for knowledge items in base ${baseId}: ${failedItemIds.join(', ')}`)
    this.name = 'DeleteItemVectorsError'
  }
}

class FailedToPersistFailureStateError extends Error {
  constructor(
    readonly itemIds: string[],
    readonly reason: string
  ) {
    super(`Failed to persist failure state for knowledge items: ${itemIds.join(', ')}`)
    this.name = 'FailedToPersistFailureStateError'
  }
}

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
  const failedItemIds = results.flatMap((result, index) => (result.status === 'rejected' ? [uniqueItemIds[index]] : []))

  if (failedItemIds.length > 0) {
    throw new DeleteItemVectorsError(base.id, failedItemIds)
  }
}

export async function deleteVectorsForEntries(
  entries: Array<{ base: KnowledgeBase; itemIds: string[] }>
): Promise<void> {
  for (const { base, itemIds } of entries) {
    try {
      await deleteItemVectors(base, itemIds)
    } catch (error) {
      const normalizedError = error instanceof Error ? error : new Error(String(error))
      logger.error('Failed to delete knowledge item vectors during runtime cleanup', normalizedError, {
        baseId: base.id,
        itemIds,
        failedItemIds: error instanceof DeleteItemVectorsError ? error.failedItemIds : itemIds
      })
    }
  }
}

export async function failItems(itemIds: string[], reason: string): Promise<void> {
  const uniqueItemIds = [...new Set(itemIds)]
  if (uniqueItemIds.length === 0) {
    return
  }

  const results = await Promise.allSettled(
    uniqueItemIds.map((itemId) => knowledgeItemService.updateStatus(itemId, 'failed', { error: reason }))
  )

  for (const [index, result] of results.entries()) {
    if (result.status === 'fulfilled') {
      continue
    }

    logger.error(
      'Failed to persist knowledge item failure state',
      result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
      {
        itemId: uniqueItemIds[index],
        reason
      }
    )
  }

  const failedItemIds = results.flatMap((result, index) => (result.status === 'rejected' ? [uniqueItemIds[index]] : []))
  if (failedItemIds.length === 0) {
    return
  }

  const aggregateError = new FailedToPersistFailureStateError(failedItemIds, reason)
  logger.error('Failed to persist failure state for knowledge items', aggregateError, {
    count: failedItemIds.length,
    itemIds: failedItemIds,
    reason
  })
  throw aggregateError
}
