import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { LoggerService } from '@main/core/logger/LoggerService'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

type MarkFailedInput = {
  baseId: string
  items: KnowledgeItem[]
  completedItemIds: Set<string>
  errorMessage: string
  failedStatusError: string
  logger: LoggerService
  logMessage: string
  logContextKey: string
}

export class KnowledgeFailedStatusCleanupError extends Error {
  constructor(
    message: string,
    readonly unrecoveredItemIds: string[]
  ) {
    super(message)
    this.name = 'KnowledgeFailedStatusCleanupError'
  }
}

export async function markUnscheduledKnowledgeItemsFailed(input: MarkFailedInput): Promise<void> {
  const unrecoveredItemIds: string[] = []

  for (const item of input.items) {
    if (input.completedItemIds.has(item.id)) {
      continue
    }

    try {
      await knowledgeItemService.updateStatus(item.id, 'failed', {
        error: input.failedStatusError
      })
      continue
    } catch (cleanupError) {
      input.logger.error(
        input.logMessage,
        cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
        {
          baseId: input.baseId,
          itemId: item.id,
          [input.logContextKey]: input.errorMessage
        }
      )
    }

    try {
      await knowledgeItemService.setSubtreeStatus(input.baseId, [item.id], 'failed', {
        error: input.failedStatusError
      })
    } catch (fallbackError) {
      unrecoveredItemIds.push(item.id)
      input.logger.error(
        'Failed to mark unscheduled knowledge item through subtree fallback',
        fallbackError instanceof Error ? fallbackError : new Error(String(fallbackError)),
        {
          baseId: input.baseId,
          itemId: item.id,
          [input.logContextKey]: input.errorMessage
        }
      )
    }
  }

  if (unrecoveredItemIds.length > 0) {
    throw new KnowledgeFailedStatusCleanupError(
      `Failed to mark unscheduled knowledge items failed; unrecovered item ids: ${unrecoveredItemIds.join(', ')}`,
      unrecoveredItemIds
    )
  }
}
