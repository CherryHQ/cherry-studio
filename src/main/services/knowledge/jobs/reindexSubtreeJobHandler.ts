import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import { JOB_ERROR_CODES } from '@main/core/job/errorCodes'
import type { JobHandler } from '@main/core/job/types'

import type { KnowledgeMutationCoordinator } from '../KnowledgeMutationCoordinator'
import type { KnowledgeWorkflowCoordinator } from '../KnowledgeWorkflowCoordinator'
import { KNOWLEDGE_ACTIVE_JOB_LIMIT, KNOWLEDGE_ACTIVE_JOB_STATUSES, knowledgeQueueName } from '../types'
import { detachKnowledgeItemFileRefs } from '../utils/cleanup/artifactCleanup'
import { deleteKnowledgeItemVectors } from '../utils/cleanup/vectorCleanup'
import type { KnowledgeReindexSubtreePayload } from './jobTypes'

const logger = loggerService.withContext('Knowledge:ReindexSubtreeJobHandler')

type JobInputWithItem = { itemId?: string; rootItemIds?: string[] } | null

export function createReindexSubtreeJobHandler(
  mutationCoordinator: KnowledgeMutationCoordinator,
  workflowCoordinator: KnowledgeWorkflowCoordinator
): JobHandler<KnowledgeReindexSubtreePayload> {
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
      logger.info('Running knowledge reindex-subtree reset', { baseId, rootItemIds, jobId: ctx.jobId })

      if (await shouldSkipDeletingSubtreeReindex(baseId, rootItemIds, ctx.jobId)) {
        ctx.reportProgress(100, { stage: 'deleting' })
        return
      }

      // Cancel old work first so stale handlers cannot race the vector reset.
      await cancelActiveSubtreeJobs(baseId, rootItemIds, 'knowledge-reindex-subtree', ctx.jobId)

      // Reset vectors, expanded children, and root statuses as one base-level mutation.
      const resetResult = await mutationCoordinator.withBaseMutationLock(baseId, async () => {
        const base = await knowledgeBaseService.getById(baseId)
        const rootItems = await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
        if (rootItems.some((item) => item.status === 'deleting')) {
          logger.info('Skipping reindex-subtree reset for deleting subtree', { baseId, rootItemIds, jobId: ctx.jobId })
          return { roots: [], skippedDeleting: true }
        }

        const selectedRoots = rootItems.filter((item) => rootItemIds.includes(item.id))
        const leafItemIds = (
          await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true, leafOnly: true })
        ).map((item) => item.id)

        await deleteKnowledgeItemVectors(base, leafItemIds)

        const leafRootIds = selectedRoots
          .filter((item) => item.type === 'file' || item.type === 'url' || item.type === 'note')
          .map((item) => item.id)
        await detachKnowledgeItemFileRefs(leafRootIds)

        const containerRootIds = selectedRoots
          .filter((item) => item.type === 'directory' || item.type === 'sitemap')
          .map((item) => item.id)
        if (containerRootIds.length > 0) {
          // Container roots are rescanned from source, so their previous expansion must be removed.
          const descendantItems = await knowledgeItemService.getSubtreeItems(baseId, containerRootIds)
          await detachKnowledgeItemFileRefs(descendantItems.map((item) => item.id))
          await knowledgeItemService.hardDeleteItems(
            baseId,
            descendantItems.map((item) => item.id)
          )
        }

        for (const item of selectedRoots) {
          await knowledgeItemService.updateStatus(
            item.id,
            item.type === 'directory' || item.type === 'sitemap' ? 'preparing' : 'processing'
          )
        }
        return { roots: selectedRoots, skippedDeleting: false }
      })
      if (resetResult.roots.length === 0) {
        ctx.reportProgress(100, {
          stage: resetResult.skippedDeleting ? 'deleting' : 'done',
          totalFiles: 0
        })
        return
      }

      // Re-enqueue only the selected roots; container children will be recreated by prepare-root.
      try {
        for (const item of resetResult.roots) {
          ctx.signal.throwIfAborted()
          await workflowCoordinator.scheduleItem(baseId, item.id, ctx.jobId)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await knowledgeItemService.setSubtreeStatus(baseId, rootItemIds, 'failed', {
          error: `Failed to schedule reindex after reset: ${message}`
        })
        throw error
      }

      ctx.reportProgress(100, { stage: 'done', totalFiles: resetResult.roots.length })
    }
  }
}

async function shouldSkipDeletingSubtreeReindex(
  baseId: string,
  rootItemIds: string[],
  jobId: string
): Promise<boolean> {
  const subtreeItems = await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
  const hasDeletingItem = subtreeItems.some((item) => item.status === 'deleting')
  if (hasDeletingItem) {
    logger.info('Skipping reindex-subtree for deleting subtree', { baseId, rootItemIds, jobId })
  }
  return hasDeletingItem
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
    .filter((job) => job.type !== 'knowledge.delete-subtree')
    .map((job) => job.id)

  await Promise.all(jobIds.map((jobId) => cancelKnowledgeSubtreeJobOrThrow(jobId, reason)))
}

async function cancelKnowledgeSubtreeJobOrThrow(jobId: string, reason: string): Promise<void> {
  const jobManager = application.get('JobManager')
  await jobManager.cancel(jobId, reason)

  const snapshot = await jobManager.get(jobId)
  if (
    snapshot?.error?.code === JOB_ERROR_CODES.CANCELLED &&
    snapshot.error.message.startsWith('Cancel timed out after')
  ) {
    throw new Error(`Knowledge subtree job cancel timed out: ${jobId}`)
  }
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
