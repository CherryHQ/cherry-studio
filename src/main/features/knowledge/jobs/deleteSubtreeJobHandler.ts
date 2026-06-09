import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import type { KnowledgeLockManager } from '../KnowledgeLockManager'
import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  knowledgeQueueName,
  reportKnowledgeProgress,
  toKnowledgeBaseId
} from '../types'
import { deleteKnowledgeItemVectors } from '../utils/cleanup/vectorCleanup'
import { isIndexableKnowledgeItem } from '../utils/items'
import { deleteKnowledgeItemFilesBestEffort } from '../utils/storage/pathStorage'
import type { KnowledgeDeleteSubtreePayload } from './jobTypes'
import { cancelJobOrThrow } from './utils/cancel'
import { narrowKnowledgeJobInput } from './utils/jobInput'

const logger = loggerService.withContext('Knowledge:DeleteSubtreeJobHandler')

export function createDeleteSubtreeJobHandler(
  knowledgeLockManager: KnowledgeLockManager
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

      const deletingSubtreeItems = (
        await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
      ).filter((item) => item.status === 'deleting')
      const deletingSubtreeItemIds = deletingSubtreeItems.map((item) => item.id)
      if (deletingSubtreeItemIds.length === 0) {
        reportKnowledgeProgress(ctx, 100, { stage: 'done' })
        return
      }

      // Stop active work touching deleting rows before removing vectors and rows.
      await cancelActiveSubtreeJobs(baseId, deletingSubtreeItemIds, 'knowledge-delete-subtree', ctx.jobId)

      // Cleanup is locked so no indexer can write vectors for rows being removed.
      await knowledgeLockManager.withBaseMutationLock(baseId, async () => {
        const base = await knowledgeBaseService.getById(baseId)
        const subtreeItems = (
          await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
        ).filter((item) => item.status === 'deleting')
        const subtreeItemIds = subtreeItems.map((item) => item.id)
        const leafItemIds = subtreeItems.filter((item) => isIndexableKnowledgeItem(item)).map((item) => item.id)

        // Vector cleanup precedes DB deletion so a retry can still discover affected item ids.
        await deleteKnowledgeItemVectors(base, leafItemIds)
        // Best-effort: a file-removal failure must not abort the row deletion below,
        // which would otherwise strand rows in 'deleting' after their vectors are gone.
        await deleteKnowledgeItemFilesBestEffort(baseId, subtreeItems, { baseId, jobId: ctx.jobId })

        await knowledgeItemService.deleteItemsByIds(baseId, subtreeItemIds)
      })

      reportKnowledgeProgress(ctx, 100, { stage: 'done' })
    }
  }
}

async function cancelActiveSubtreeJobs(
  baseId: string,
  rootItemIds: string[],
  reason: string,
  currentJobId?: string
): Promise<void> {
  const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
  const subtreeIds = new Set(subtreeItems.map((item) => item.id))
  if (subtreeIds.size === 0) {
    return
  }

  const jobManager = application.get('JobManager')
  const activeJobs = await jobManager.list({
    queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
    status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
    limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
  })
  const jobIds = activeJobs
    .filter((job) => job.id !== currentJobId && jobTouchesSubtree(job, subtreeIds))
    .map((job) => job.id)
  const fileProcessingJobIds = activeJobs.flatMap((job) => getFileProcessingJobIdsForTouchedSubtree(job, subtreeIds))

  await Promise.all([
    ...jobIds.map((jobId) => cancelJobOrThrow(jobId, reason)),
    ...fileProcessingJobIds.map((jobId) => cancelJobOrThrow(jobId, reason))
  ])
}

function jobTouchesSubtree(job: { type: string; input: unknown }, subtreeIds: Set<string>): boolean {
  const narrowed = narrowKnowledgeJobInput(job)
  if (!narrowed) {
    return false
  }
  if ('itemId' in narrowed.input && subtreeIds.has(narrowed.input.itemId)) {
    return true
  }
  return 'rootItemIds' in narrowed.input && narrowed.input.rootItemIds.some((itemId) => subtreeIds.has(itemId))
}

function getFileProcessingJobIdsForTouchedSubtree(
  job: { type: string; input: unknown },
  subtreeIds: Set<string>
): string[] {
  const narrowed = narrowKnowledgeJobInput(job)
  if (
    narrowed?.type === 'knowledge.check-file-processing-result' &&
    subtreeIds.has(narrowed.input.itemId) &&
    narrowed.input.fileProcessingJobId
  ) {
    return [narrowed.input.fileProcessingJobId]
  }
  return []
}
