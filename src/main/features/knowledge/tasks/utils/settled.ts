import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { JobSettledEvent } from '@main/core/job/types'
import type { LoggerService } from '@main/core/logger/LoggerService'
import { trackMainProductEvent } from '@main/services/productAnalytics'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import {
  KNOWLEDGE_ITEM_ERROR_EMPTY_INDEXABLE_TEXT,
  KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
} from '@shared/data/types/knowledge'

export async function markKnowledgeItemFailedOnSettled(
  event: JobSettledEvent<{ itemId: string }>,
  logger: LoggerService,
  logMessage: string
): Promise<void> {
  if (event.status === 'completed') return

  const { itemId } = event.input

  // A cancelled indexing job for a non-deleting item means it was aborted by an
  // app quit / restart (knowledge has no per-item user cancel), so store the
  // localized `indexing_interrupted` code (the UI maps it to a "reindex to
  // finish" message) instead of the raw internal abort string.
  const reason =
    event.status === 'cancelled'
      ? KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
      : event.error?.message?.trim() || `Job ${event.status}`
  try {
    const item = knowledgeItemService.getById(itemId)
    if (item.status === 'deleting') return

    knowledgeItemService.updateStatus(itemId, 'failed', { error: reason })
    trackMainProductEvent({
      event: 'feature_used',
      feature: 'knowledge',
      action: 'item_processed',
      target: item.type,
      status: event.status === 'cancelled' ? 'cancelled' : 'error',
      errorReason:
        event.status === 'cancelled'
          ? 'indexing_interrupted'
          : reason === KNOWLEDGE_ITEM_ERROR_EMPTY_INDEXABLE_TEXT
            ? 'empty_indexable_text'
            : 'other'
    })
  } catch (error) {
    if (isDataApiNotFoundError(error)) return
    logger.error(logMessage, error instanceof Error ? error : new Error(String(error)), {
      jobId: event.jobId,
      itemId
    })
  }
}
