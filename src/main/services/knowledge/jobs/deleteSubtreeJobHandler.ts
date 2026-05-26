import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import type { KnowledgeMutationCoordinator } from '../KnowledgeMutationCoordinator'
import { KNOWLEDGE_ACTIVE_JOB_LIMIT, KNOWLEDGE_ACTIVE_JOB_STATUSES, knowledgeQueueName } from '../types'
import { detachKnowledgeItemFileRefs } from '../utils/cleanup/artifactCleanup'
import { deleteKnowledgeItemVectors } from '../utils/cleanup/vectorCleanup'
import type { KnowledgeDeleteSubtreePayload } from './jobTypes'

const logger = loggerService.withContext('Knowledge:DeleteSubtreeJobHandler')

type JobInputWithItem = { itemId?: string; rootItemIds?: string[] } | null

export function createDeleteSubtreeJobHandler(
  mutationCoordinator: KnowledgeMutationCoordinator
): JobHandler<KnowledgeDeleteSubtreePayload> {
  return {
    recovery: 'retry',
    defaultQueue: (input) => knowledgeQueueName(input.baseId),
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
      // Stop active work touching this subtree before removing vectors and rows.
      await cancelActiveSubtreeJobs(baseId, rootItemIds, 'knowledge-delete-subtree', ctx.jobId)

      // Cleanup is locked so no indexer can write vectors for rows being removed.
      await mutationCoordinator.withBaseMutationLock(baseId, async () => {
        const base = await knowledgeBaseService.getById(baseId)
        const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
        const subtreeItemIds = subtreeItems.map((item) => item.id)
        const leafItemIds = subtreeItems
          .filter((item) => item.type === 'file' || item.type === 'url' || item.type === 'note')
          .map((item) => item.id)

        // Vector cleanup precedes DB deletion so a retry can still discover affected item ids.
        await deleteKnowledgeItemVectors(base, leafItemIds)
        await detachKnowledgeItemFileRefs(subtreeItemIds)

        await knowledgeItemService.hardDeleteItems(baseId, subtreeItemIds)
      })

      ctx.reportProgress(100, { stage: 'done' })
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
    queue: knowledgeQueueName(baseId),
    status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
    limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
  })
  const jobIds = activeJobs
    .filter((job) => job.id !== currentJobId && jobTouchesSubtree(job.input as JobInputWithItem, subtreeIds))
    .map((job) => job.id)

  await Promise.all(
    jobIds.map((jobId) =>
      jobManager.cancel(jobId, reason).catch((error) => {
        logger.warn('Failed to cancel knowledge subtree job', {
          baseId,
          jobId,
          reason,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    )
  )
}

function jobTouchesSubtree(input: JobInputWithItem, subtreeIds: Set<string>): boolean {
  if (!input) {
    return false
  }
  if (input.itemId && subtreeIds.has(input.itemId)) {
    return true
  }
  return input.rootItemIds?.some((itemId) => subtreeIds.has(itemId)) ?? false
}
