import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler, JobSettledEvent } from '@main/core/job/types'
import type { JobSnapshot } from '@shared/data/api/schemas/jobs'
import type { KnowledgeItemStatus } from '@shared/data/types/knowledge'

import type { KnowledgeLockManager } from '../KnowledgeLockManager'
import type { KnowledgeWorkflowService } from '../KnowledgeWorkflowService'
import {
  KNOWLEDGE_ACTIVE_JOB_LIMIT,
  KNOWLEDGE_ACTIVE_JOB_STATUSES,
  knowledgeQueueName,
  reportKnowledgeProgress,
  toKnowledgeBaseId,
  toKnowledgeItemId
} from '../types'
import { deleteKnowledgeItemVectors } from '../utils/cleanup/vectorCleanup'
import { isContainerKnowledgeItem } from '../utils/items'
import type { KnowledgeReindexSubtreePayload } from './jobTypes'
import { narrowKnowledgeJobInput } from './utils/jobInput'

const logger = loggerService.withContext('Knowledge:ReindexSubtreeJobHandler')
const REINDEX_RECOVERY_ACTIVE_STATUSES = new Set<KnowledgeItemStatus>(['preparing', 'processing'])

export function createReindexSubtreeJobHandler(
  knowledgeLockManager: KnowledgeLockManager,
  workflowService: KnowledgeWorkflowService
): JobHandler<KnowledgeReindexSubtreePayload> {
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
      logger.info('Running knowledge reindex-subtree reset', { baseId, rootItemIds, jobId: ctx.jobId })

      // Reindex is admitted only for completed/failed subtrees, but delete may win
      // after enqueue. Keep this fast path so delete remains the only preemptive action.
      if (await shouldSkipDeletingSubtreeReindex(baseId, rootItemIds, ctx.jobId)) {
        reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
        return
      }

      // Reset vectors, expanded children, and root statuses as one base-level mutation.
      const resetResult = await knowledgeLockManager.withBaseMutationLock(baseId, async () => {
        const base = await knowledgeBaseService.getById(baseId)
        const rootItems = await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true })
        // Re-check under the mutation lock so reindex cannot turn a just-deleted
        // subtree back into preparing/processing during cleanup/reset.
        if (rootItems.some((item) => item.status === 'deleting')) {
          logger.info('Skipping reindex-subtree reset for deleting subtree', { baseId, rootItemIds, jobId: ctx.jobId })
          return { roots: [], skippedDeleting: true }
        }

        const selectedRoots = rootItems.filter((item) => rootItemIds.includes(item.id))
        const leafItemIds = (
          await knowledgeItemService.getSubtreeItems(baseId, rootItemIds, { includeRoots: true, leafOnly: true })
        ).map((item) => item.id)

        await deleteKnowledgeItemVectors(base, leafItemIds)

        const containerRootIds = selectedRoots.filter((item) => isContainerKnowledgeItem(item)).map((item) => item.id)
        if (containerRootIds.length > 0) {
          // Container roots are rescanned from source, so their previous expansion must be removed.
          const descendantItems = await knowledgeItemService.getSubtreeItems(baseId, containerRootIds)
          await knowledgeItemService.deleteItemsByIds(
            baseId,
            descendantItems.map((item) => item.id)
          )
        }

        for (const item of selectedRoots) {
          await knowledgeItemService.updateStatus(item.id, item.type === 'directory' ? 'preparing' : 'processing')
        }
        return { roots: selectedRoots, skippedDeleting: false }
      })
      if (resetResult.roots.length === 0) {
        reportKnowledgeProgress(ctx, 100, {
          stage: resetResult.skippedDeleting ? 'deleting' : 'done',
          totalFiles: 0
        })
        return
      }

      // Re-enqueue only the selected roots; container children will be recreated by prepare-root.
      const completedSchedulingRootIds = new Set<string>()
      try {
        for (const item of resetResult.roots) {
          ctx.signal.throwIfAborted()
          await workflowService.scheduleItem(toKnowledgeBaseId(baseId), toKnowledgeItemId(item.id), ctx.jobId)
          completedSchedulingRootIds.add(item.id)
        }
      } catch (error) {
        // Roots are already visible as active after reset. If scheduling the durable
        // follow-up job fails, flip them to failed so the UI does not show stuck work.
        const message = error instanceof Error ? error.message : String(error)
        const unscheduledRootIds = rootItemIds.filter((rootItemId) => !completedSchedulingRootIds.has(rootItemId))
        if (unscheduledRootIds.length > 0) {
          await knowledgeItemService.setSubtreeStatus(baseId, unscheduledRootIds, 'failed', {
            error: `Failed to schedule reindex after reset: ${message}`
          })
        }
        throw error
      }

      reportKnowledgeProgress(ctx, 100, { stage: 'done', totalFiles: resetResult.roots.length })
    },

    async onSettled(event) {
      await markReindexSubtreeFailedOnSettled(event)
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

async function markReindexSubtreeFailedOnSettled(event: JobSettledEvent): Promise<void> {
  if (event.status === 'completed') return

  const jobManager = application.get('JobManager')
  const snapshot = await jobManager.get(event.jobId)
  const narrowed = snapshot ? narrowKnowledgeJobInput(snapshot) : null
  if (!narrowed || !('rootItemIds' in narrowed.input) || narrowed.input.rootItemIds.length === 0) return
  const { input } = narrowed

  const reason = event.error?.message?.trim() || `Job ${event.status}`
  try {
    const activeJobs = await jobManager.list({
      queue: knowledgeQueueName(toKnowledgeBaseId(input.baseId)),
      status: [...KNOWLEDGE_ACTIVE_JOB_STATUSES],
      limit: KNOWLEDGE_ACTIVE_JOB_LIMIT
    })
    const rootsWithFollowUpJobs = getRootsWithFollowUpJobs(activeJobs, event.jobId, input.rootItemIds)
    const rootItems = await knowledgeItemService.getSubtreeItems(input.baseId, input.rootItemIds, {
      includeRoots: true
    })
    const rootsToFail = rootItems
      .filter((item) => input.rootItemIds.includes(item.id))
      .filter((item) => REINDEX_RECOVERY_ACTIVE_STATUSES.has(item.status))
      .filter((item) => !rootsWithFollowUpJobs.has(item.id))
      .map((item) => item.id)

    if (rootsToFail.length === 0) return

    await knowledgeItemService.setSubtreeStatus(input.baseId, rootsToFail, 'failed', {
      error: `Reindex job ${event.status}: ${reason}`
    })
  } catch (error) {
    logger.error(
      'Failed to flip reindex-subtree targets to failed in onSettled',
      error instanceof Error ? error : new Error(String(error)),
      {
        jobId: event.jobId,
        baseId: input.baseId,
        rootItemIds: input.rootItemIds
      }
    )
  }
}

function getRootsWithFollowUpJobs(activeJobs: JobSnapshot[], reindexJobId: string, rootItemIds: string[]): Set<string> {
  const rootItemIdSet = new Set(rootItemIds)
  const rootsWithFollowUpJobs = new Set<string>()
  for (const job of activeJobs) {
    if (job.parentId !== reindexJobId) continue

    const narrowed = narrowKnowledgeJobInput(job)
    if (narrowed && 'itemId' in narrowed.input && rootItemIdSet.has(narrowed.input.itemId)) {
      rootsWithFollowUpJobs.add(narrowed.input.itemId)
    }
  }
  return rootsWithFollowUpJobs
}
