import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import type { JobSettledEvent } from '@main/core/job/types'
import type { LoggerService } from '@main/core/logger/LoggerService'
import { ErrorCode, isDataApiError } from '@shared/data/api'

import { narrowKnowledgeJobInput } from './jobInput'

export function isDataApiNotFoundError(error: unknown): boolean {
  return isDataApiError(error) && error.code === ErrorCode.NOT_FOUND
}

export async function markKnowledgeItemFailedOnSettled(
  event: JobSettledEvent,
  logger: LoggerService,
  logMessage: string
): Promise<void> {
  if (event.status === 'completed') return

  const jobManager = application.get('JobManager')
  const snapshot = await jobManager.get(event.jobId)
  const narrowed = snapshot ? narrowKnowledgeJobInput(snapshot) : null
  if (!narrowed || !('itemId' in narrowed.input)) return
  const { input } = narrowed

  const reason = event.error?.message?.trim() || `Job ${event.status}`
  try {
    const item = await knowledgeItemService.getById(input.itemId)
    if (item.status === 'deleting') return

    await knowledgeItemService.updateStatus(input.itemId, 'failed', { error: reason })
  } catch (error) {
    if (isDataApiNotFoundError(error)) return
    logger.error(logMessage, error instanceof Error ? error : new Error(String(error)), {
      jobId: event.jobId,
      itemId: input.itemId
    })
  }
}
