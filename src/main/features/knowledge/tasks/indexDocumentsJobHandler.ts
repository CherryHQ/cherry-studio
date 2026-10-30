import './jobTypes'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import type { IndexKnowledgeItem } from '../ingestion/indexKnowledgeItem'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId } from '../types'
import type { KnowledgeIndexDocumentsPayload } from './jobTypes'
import { markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:IndexDocumentsJobHandler')

export function createIndexDocumentsJobHandler(
  indexKnowledgeItem: IndexKnowledgeItem
): JobHandler<KnowledgeIndexDocumentsPayload> {
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
    defaultTimeoutMs: 30 * 60 * 1000,

    async execute(ctx) {
      await indexKnowledgeItem({
        baseId: ctx.input.baseId,
        itemId: ctx.input.itemId,
        signal: ctx.signal,
        reportProgress: (progress, detail) => reportKnowledgeProgress(ctx, progress, detail)
      })
    },

    async onSettled(event) {
      await markKnowledgeItemFailedOnSettled(event, logger, 'Failed to flip knowledge item to failed in onSettled')
    }
  }
}
