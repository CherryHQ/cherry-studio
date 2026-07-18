import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobHandler, JobSettledEvent } from '@main/core/job/types'
import { ACTIVE_JOB_STATUSES, type JobSnapshot } from '@shared/data/api/schemas/jobs'
import { KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED, type KnowledgeItemStatus } from '@shared/data/types/knowledge'

import type { KnowledgeItemScheduler } from '../ingestion/KnowledgeIngestionService'
import { canKnowledgeItemRebuildSource, isContainerKnowledgeItem } from '../items'
import { deleteKnowledgeItemFilesBestEffort } from '../pathStorage'
import { deleteKnowledgeItemVectors } from '../pipeline/vectorstore/vectorCleanup'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeReindexSubtreePayload } from './jobTypes'
import { narrowKnowledgeJobInput } from './utils/jobInput'
import { resolveLiveKnowledgeSubtree } from './utils/liveItem'

const logger = loggerService.withContext('Knowledge:ReindexSubtreeJobHandler')
const REINDEX_RECOVERY_ACTIVE_STATUSES = new Set<KnowledgeItemStatus>(['preparing', 'processing'])

export function createReindexSubtreeJobHandler(
  knowledgeLockManager: KeyedMutex,
  ingestionService: KnowledgeItemScheduler
): JobHandler<KnowledgeReindexSubtreePayload> {
  return {
    // Don't auto-resume on restart — a deliberate app quit must not re-spend the
    // embedding API; the item is parked at `failed` and reindexed on demand.
    recovery: 'abandon',
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
      if (shouldSkipDeletingSubtreeReindex(baseId, rootItemIds, ctx.jobId)) {
        reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
        return
      }

      // Reset vectors, expanded children, and root statuses as one base-level mutation.
      const resetResult = await knowledgeLockManager.runExclusive(baseId, async () => {
        const base = knowledgeBaseService.getById(baseId)
        // Re-check under the mutation lock so reindex cannot turn a just-deleted
        // subtree back into preparing/processing during cleanup/reset.
        const subtreeResult = resolveLiveKnowledgeSubtree(baseId, rootItemIds)
        if ('skip' in subtreeResult) {
          logger.info('Skipping reindex-subtree reset for deleting subtree', { baseId, rootItemIds, jobId: ctx.jobId })
          return { roots: [], skippedDeleting: true, skippedMissingSource: 0 }
        }
        const rootItems = subtreeResult.items

        const selectedRoots = rootItems.filter((item) => rootItemIds.includes(item.id))
        // Admission (assertSubtreesCanReindex) already rejected roots whose source is gone, but the
        // source can vanish between admission and acquiring this lock. Re-check right before the delete:
        // a root that can no longer rebuild keeps its existing vectors (stays completed/searchable)
        // instead of being wiped with nothing to re-read from.
        const rebuildableRoots: typeof selectedRoots = []
        const missingSourceRootIds: string[] = []
        for (const root of selectedRoots) {
          if (await canKnowledgeItemRebuildSource(baseId, root)) {
            rebuildableRoots.push(root)
          } else {
            missingSourceRootIds.push(root.id)
          }
        }
        if (missingSourceRootIds.length > 0) {
          logger.warn('Skipping reindex for roots whose source could not be read before the mutation lock', {
            baseId,
            missingSourceRootIds,
            jobId: ctx.jobId
          })
        }
        if (rebuildableRoots.length === 0) {
          return { roots: [], skippedDeleting: false, skippedMissingSource: missingSourceRootIds.length }
        }

        const rebuildableRootIds = rebuildableRoots.map((item) => item.id)
        const leafItemIds = knowledgeItemService
          .getSubtreeItems(baseId, rebuildableRootIds, { includeRoots: true, leafOnly: true })
          .map((item) => item.id)

        await deleteKnowledgeItemVectors(base, leafItemIds)

        const containerRootIds = rebuildableRoots
          .filter((item) => isContainerKnowledgeItem(item))
          .map((item) => item.id)
        if (containerRootIds.length > 0) {
          // Container roots are rescanned from source, so their previous expansion must be removed.
          const descendantItems = knowledgeItemService.getSubtreeItems(baseId, containerRootIds)
          // Best-effort: a file-removal failure must not abort the row deletion below.
          await deleteKnowledgeItemFilesBestEffort(baseId, descendantItems, { baseId, jobId: ctx.jobId })
          knowledgeItemService.deleteItemsByIds(
            baseId,
            descendantItems.map((item) => item.id)
          )
        }

        for (const item of rebuildableRoots) {
          knowledgeItemService.updateStatus(item.id, item.type === 'directory' ? 'preparing' : 'processing')
        }
        return { roots: rebuildableRoots, skippedDeleting: false, skippedMissingSource: missingSourceRootIds.length }
      })
      if (resetResult.roots.length === 0) {
        reportKnowledgeProgress(ctx, 100, {
          stage: resetResult.skippedDeleting ? 'deleting' : 'done',
          totalFiles: 0,
          ...(resetResult.skippedMissingSource > 0 ? { skippedMissingSource: resetResult.skippedMissingSource } : {})
        })
        return
      }

      // Re-enqueue only the selected roots; container children will be recreated by prepare-root.
      const completedSchedulingRootIds = new Set<string>()
      try {
        for (const item of resetResult.roots) {
          ctx.signal.throwIfAborted()
          await ingestionService.scheduleItem(toKnowledgeBaseId(baseId), toKnowledgeItemId(item.id), ctx.jobId)
          completedSchedulingRootIds.add(item.id)
        }
      } catch (error) {
        // Roots are already visible as active after reset. If scheduling the durable
        // follow-up job fails, flip them to failed so the UI does not show stuck work.
        // Only the rebuildable roots were reset/activated — missing-source roots were left
        // untouched (still completed on their existing vectors), so they must not be failed here.
        const message = error instanceof Error ? error.message : String(error)
        const unscheduledRootIds = resetResult.roots
          .map((item) => item.id)
          .filter((rootItemId) => !completedSchedulingRootIds.has(rootItemId))
        if (unscheduledRootIds.length > 0) {
          // A shutdown abort (deliberate quit) lands here when `throwIfAborted` fires in the
          // scheduling loop. Store the localized `indexing_interrupted` code instead of a raw
          // `…: JobManager shutdown` string the tooltip would pass through verbatim; a genuine
          // scheduling failure keeps its diagnostic message.
          const failError = ctx.signal.aborted
            ? KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
            : `Failed to schedule reindex after reset: ${message}`
          knowledgeItemService.setSubtreeStatus(baseId, unscheduledRootIds, 'failed', {
            error: failError
          })
        }
        throw error
      }

      reportKnowledgeProgress(ctx, 100, {
        stage: 'done',
        totalFiles: resetResult.roots.length,
        ...(resetResult.skippedMissingSource > 0 ? { skippedMissingSource: resetResult.skippedMissingSource } : {})
      })
    },

    async onSettled(event) {
      await markReindexSubtreeFailedOnSettled(event)
    }
  }
}

function shouldSkipDeletingSubtreeReindex(baseId: string, rootItemIds: string[], jobId: string): boolean {
  const result = resolveLiveKnowledgeSubtree(baseId, rootItemIds)
  const isSkipped = 'skip' in result
  if (isSkipped) {
    logger.info('Skipping reindex-subtree for deleting subtree', { baseId, rootItemIds, jobId })
  }
  return isSkipped
}

async function markReindexSubtreeFailedOnSettled(
  event: JobSettledEvent<KnowledgeReindexSubtreePayload>
): Promise<void> {
  if (event.status === 'completed') return

  const { baseId, rootItemIds } = event.input
  if (rootItemIds.length === 0) return

  const reason = event.error?.message?.trim() || `Job ${event.status}`
  try {
    const jobManager = application.get('JobManager')
    const activeJobs = await jobManager.list({
      queue: knowledgeQueueName(toKnowledgeBaseId(baseId)),
      status: [...ACTIVE_JOB_STATUSES],
      parentId: event.jobId
    })
    const rootsWithFollowUpJobs = getRootsWithFollowUpJobs(activeJobs, rootItemIds)
    const rootItems = knowledgeItemService.getSubtreeItems(baseId, rootItemIds, {
      includeRoots: true
    })
    const rootsToFail = rootItems
      .filter((item) => rootItemIds.includes(item.id))
      .filter((item) => REINDEX_RECOVERY_ACTIVE_STATUSES.has(item.status))
      .filter((item) => !rootsWithFollowUpJobs.has(item.id))
      .map((item) => item.id)

    if (rootsToFail.length === 0) return

    // A cancelled reindex job was aborted by an app quit (knowledge has no per-item user
    // cancel), so store the localized `indexing_interrupted` code instead of a raw English
    // string the tooltip would pass through verbatim. Mirrors settled.ts; other terminal
    // states keep their diagnostic `Reindex job …` message.
    const error =
      event.status === 'cancelled'
        ? KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED
        : `Reindex job ${event.status}: ${reason}`
    knowledgeItemService.setSubtreeStatus(baseId, rootsToFail, 'failed', { error })
  } catch (error) {
    logger.error(
      'Failed to flip reindex-subtree targets to failed in onSettled',
      error instanceof Error ? error : new Error(String(error)),
      {
        jobId: event.jobId,
        baseId,
        rootItemIds
      }
    )
  }
}

function getRootsWithFollowUpJobs(activeJobs: JobSnapshot[], rootItemIds: string[]): Set<string> {
  const rootItemIdSet = new Set(rootItemIds)
  const rootsWithFollowUpJobs = new Set<string>()
  for (const job of activeJobs) {
    const narrowed = narrowKnowledgeJobInput(job)
    if (narrowed && 'itemId' in narrowed.input && rootItemIdSet.has(narrowed.input.itemId)) {
      rootsWithFollowUpJobs.add(narrowed.input.itemId)
    }
  }
  return rootsWithFollowUpJobs
}
