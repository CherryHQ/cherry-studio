import './jobTypes'

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobHandler } from '@main/core/job/types'

import { purgeKnowledgeSubtreeWithinLock } from '../ingestion/subtreePurge'
import { reclaimKnowledgeIndexSpace } from '../pipeline/vectorstore/vectorCleanup'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId } from '../types'
import type { KnowledgeDeleteSubtreePayload } from './jobTypes'
import { cancelActiveKnowledgeJobs } from './utils/cancel'

const logger = loggerService.withContext('Knowledge:DeleteSubtreeJobHandler')

export function createDeleteSubtreeJobHandler(
  knowledgeLockManager: KeyedMutex
): JobHandler<KnowledgeDeleteSubtreePayload> {
  return {
    recovery: 'retry',
    defaultQueue: (input) => knowledgeQueueName(toKnowledgeBaseId(input.baseId)),
    defaultConcurrency: 5,
    defaultRetryPolicy: {
      maxAttempts: 3,
      backoff: 'exponential',
      baseDelayMs: 2000,
      maxDelayMs: 60_000
    },
    defaultTimeoutMs: 10 * 60 * 1000,

    async execute(ctx) {
      const { baseId, rootItemIds } = ctx.input
      ctx.signal.throwIfAborted()
      logger.info('Running knowledge delete-subtree cleanup', { baseId, rootItemIds, jobId: ctx.jobId })

      const deletingSubtreeItems = knowledgeItemService
        .getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
        .filter((item) => item.status === 'deleting')
      const deletingSubtreeItemIds = deletingSubtreeItems.map((item) => item.id)
      if (deletingSubtreeItemIds.length === 0) {
        reportKnowledgeProgress(ctx, 100, { stage: 'done' })
        return
      }

      // Stop active work touching deleting rows before removing vectors and rows.
      await cancelActiveKnowledgeJobs(baseId, 'knowledge-delete-subtree', {
        rootItemIds: deletingSubtreeItemIds,
        excludeJobId: ctx.jobId,
        onCancelTimeout: 'throw'
      })

      // Cleanup is locked so no indexer can write vectors for rows being removed.
      await knowledgeLockManager.runExclusive(baseId, async () => {
        const base = knowledgeBaseService.getById(baseId)
        const subtreeItems = knowledgeItemService
          .getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
          .filter((item) => item.status === 'deleting')
        await purgeKnowledgeSubtreeWithinLock(base, subtreeItems, { baseId, jobId: ctx.jobId })
        // Return the freed pages to the OS (best-effort, large deletes only). Inside the
        // lock so the VACUUM never races an indexer write on this base's index.
        await reclaimKnowledgeIndexSpace(base)
      })

      reportKnowledgeProgress(ctx, 100, { stage: 'done' })
    }
  }
}
