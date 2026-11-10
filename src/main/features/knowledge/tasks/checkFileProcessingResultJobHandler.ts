import './jobTypes'
import { application } from '@application'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'
import type { KeyedMutex } from '@shared/utils/async'

import type { KnowledgeItemScheduler } from '../ingestion/KnowledgeIngestionService'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeCheckFileProcessingResultPayload } from './jobTypes'
import { cancelFileProcessingTaskOrThrow } from './utils/cancel'
import { resolveLiveKnowledgeItem } from './utils/liveItem'
import { markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:CheckFileProcessingResultJobHandler')
const FILE_PROCESSING_ITEM_UNAVAILABLE_CANCEL_REASON = 'knowledge-file-processing-item-unavailable'

export function createCheckFileProcessingResultJobHandler(
  knowledgeLockManager: KeyedMutex,
  ingestionService: KnowledgeItemScheduler
): JobHandler<KnowledgeCheckFileProcessingResultPayload> {
  return {
    // Don't auto-resume on restart — a deliberate app quit must not re-spend the
    // embedding API; the item is parked at `failed` and reindexed on demand.
    recovery: 'abandon',
    defaultQueue: (input) => knowledgeQueueName(toKnowledgeBaseId(input.baseId)),
    defaultConcurrency: 5,
    defaultRetryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 1000,
      maxDelayMs: 30_000
    },
    defaultTimeoutMs: 2 * 60 * 1000,

    async execute(ctx) {
      const { baseId, itemId, fileProcessingTaskId } = ctx.input
      // A direct add has no parent; this job's own id then scopes the index idempotency key.
      const workflowParentJobId = ctx.parentId ?? ctx.jobId
      ctx.signal.throwIfAborted()

      if (shouldSkipMissingOrDeletingItem(baseId, itemId, ctx.jobId)) {
        await cancelFileProcessingTaskOrThrow(fileProcessingTaskId, FILE_PROCESSING_ITEM_UNAVAILABLE_CANCEL_REASON)
        return
      }

      const task = await application.get('FileProcessingService').getTask(fileProcessingTaskId)

      if (!task) {
        markItemFailed(itemId, `File processing task not found: ${fileProcessingTaskId}`)
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }

      if (task.status === 'failed' || task.status === 'cancelled') {
        markItemFailed(itemId, `File processing task ${fileProcessingTaskId} ${task.status}: ${task.error}`)
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }

      // The item is indexed from its own processedRelativePath; the artifact only has to be markdown.
      if (task.status !== 'completed' || task.artifact.kind !== 'file') {
        markItemFailed(itemId, `Invalid file processing result for task ${fileProcessingTaskId}`)
        reportKnowledgeProgress(ctx, 100, { stage: 'failed' })
        return
      }
      const indexedRelativePath = ctx.input.processedRelativePath

      const canContinue = await knowledgeLockManager.runExclusive(baseId, async () => {
        if (shouldSkipMissingOrDeletingItem(baseId, itemId, ctx.jobId)) {
          return false
        }

        knowledgeItemService.updateIndexedRelativePath(itemId, indexedRelativePath)
        await ingestionService.scheduleIndexing(
          toKnowledgeBaseId(baseId),
          toKnowledgeItemId(itemId),
          workflowParentJobId
        )
        return true
      })
      if (!canContinue) {
        return
      }
      reportKnowledgeProgress(ctx, 100, { stage: 'done' })
    },

    async onSettled(event) {
      await markKnowledgeItemFailedOnSettled(
        event,
        logger,
        'Failed to flip knowledge file-processing check target to failed in onSettled'
      )
    }
  }
}

function shouldSkipMissingOrDeletingItem(baseId: string, itemId: string, jobId: string): boolean {
  const result = resolveLiveKnowledgeItem(itemId)
  if ('skip' in result) {
    if (result.skip === 'deleting') {
      logger.info('Skipping file-processing check for deleting item', { baseId, itemId, jobId })
    } else {
      logger.info('Skipping file-processing check for missing item', { baseId, itemId, jobId })
    }
    return true
  }
  if (result.item.baseId !== baseId) {
    throw new Error(`Knowledge item '${itemId}' does not belong to base '${baseId}'`)
  }
  return false
}

function markItemFailed(itemId: string, error: string): void {
  const result = resolveLiveKnowledgeItem(itemId)
  if ('skip' in result) {
    if (result.skip === 'deleting') {
      logger.info('Skipping mark failed for deleting item', { itemId, error })
    } else {
      logger.info('Skipping mark failed for missing item', { itemId, error })
    }
    return
  }
  knowledgeItemService.updateStatus(itemId, 'failed', { error })
}
