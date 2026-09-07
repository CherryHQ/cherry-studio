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
}

export function markUnscheduledKnowledgeItemsFailed(input: MarkFailedInput): void {
  const unrecoveredItemIds: string[] = []

  for (const item of input.items) {
    if (input.completedItemIds.has(item.id)) {
      continue
    }

    try {
      knowledgeItemService.setSubtreeStatus(input.baseId, [item.id], 'failed', {
        error: input.failedStatusError
      })
    } catch (cleanupError) {
      unrecoveredItemIds.push(item.id)
      input.logger.error(
        input.logMessage,
        cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
        {
          baseId: input.baseId,
          itemId: item.id,
          scheduleError: input.errorMessage
        }
      )
    }
  }

  if (unrecoveredItemIds.length > 0) {
    throw new Error(
      `Failed to mark unscheduled knowledge items failed; unrecovered item ids: ${unrecoveredItemIds.join(', ')}`
    )
  }
}
