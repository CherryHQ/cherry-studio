// Side-effect import — picks up declare-module merges for both knowledge job
// types, so the `jobManager.enqueue('knowledge.index-leaf', …)` call below
// type-checks without a direct dependency on indexLeafJobHandler.ts.
import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import { commitPreparedKnowledgeItem, expandKnowledgeItemForRuntime } from '../runtime/utils/prepare'
import type { KnowledgePrepareRootPayload } from './jobTypes'

const logger = loggerService.withContext('prepareRootJobHandler')

const ACTIVE_STATUSES = ['pending', 'delayed', 'running'] as const
const ACTIVE_JOB_LIMIT = 5000

export const prepareRootJobHandler: JobHandler<KnowledgePrepareRootPayload> = {
  recovery: 'retry',
  defaultQueue: (input) => `base.${input.baseId}`,
  defaultConcurrency: 5,
  defaultRetryPolicy: {
    maxAttempts: 3,
    backoff: 'exponential',
    baseDelayMs: 2000,
    maxDelayMs: 60_000
  },
  defaultTimeoutMs: 10 * 60 * 1000,

  async execute(ctx) {
    const { baseId, itemId } = ctx.input
    const runtime = application.get('KnowledgeRuntimeService')
    const jobManager = application.get('JobManager')

    ctx.signal.throwIfAborted()
    // Treat NOT_FOUND on either lookup as "base was deleted concurrently" —
    // return cleanly so the job settles as 'completed' rather than burning
    // retry attempts on dead rows.
    let item: KnowledgeItem
    try {
      await knowledgeBaseService.getById(baseId)
      item = await knowledgeItemService.getById(itemId)
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        logger.info('Skipping prepare-root for missing base or item (likely deleted concurrently)', {
          baseId,
          itemId,
          jobId: ctx.jobId
        })
        ctx.reportProgress(100, { stage: 'item-gone' })
        return
      }
      throw error
    }

    // Idempotent retry preamble — safe to run on every attempt:
    //
    // (1) Cancel any orphan index-leaf jobs left over from a prior attempt of
    //     THIS prepare-root. We identify them by `parentJobId === ctx.jobId`
    //     (the jobId is stable across retries). Without this, recovered child
    //     jobs would dispatch and fail with NOT_FOUND once we delete their
    //     leaf rows below.
    const activeJobs = await jobManager.list({
      queue: `base.${baseId}`,
      status: [...ACTIVE_STATUSES],
      limit: ACTIVE_JOB_LIMIT
    })
    const ourOrphans = activeJobs.filter((job) => {
      if (job.id === ctx.jobId) return false
      const payload = job.input as { parentJobId?: string | null } | null
      return payload?.parentJobId === ctx.jobId
    })

    if (ourOrphans.length > 0) {
      logger.info('Cancelling orphan child jobs from previous attempt', {
        baseId,
        itemId,
        jobId: ctx.jobId,
        orphanCount: ourOrphans.length
      })
      await Promise.all(
        ourOrphans.map((job) =>
          jobManager.cancel(job.id, 'prepare-root-retry').catch((error) => {
            logger.warn('Failed to cancel orphan index-leaf job (already terminal?)', {
              orphanJobId: job.id,
              error: error instanceof Error ? error.message : String(error)
            })
          })
        )
      )
    }

    ctx.signal.throwIfAborted()
    ctx.reportProgress(0, { stage: 'scanning' })
    const prepared = await expandKnowledgeItemForRuntime({ item, signal: ctx.signal })

    ctx.signal.throwIfAborted()
    ctx.reportProgress(50, { stage: 'committing', currentFile: 0, totalFiles: 0 })

    // Commit the prepared tree under the Layer 3 lock. External discovery
    // (directory scan / sitemap fetch / FileManager upsert) runs before this
    // point; the lock is reserved for Knowledge state changes and child job
    // submission so a concurrent delete/reindex cannot interleave with a
    // half-accepted expansion.
    const leafItems = await runtime.runWithBaseWriteLockForBase(baseId, async () => {
      ctx.signal.throwIfAborted()

      try {
        await knowledgeBaseService.getById(baseId)
        item = await knowledgeItemService.getById(itemId)
      } catch (error) {
        if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
          logger.info('Skipping prepare-root commit for missing base or item (likely deleted concurrently)', {
            baseId,
            itemId,
            jobId: ctx.jobId
          })
          return []
        }
        throw error
      }

      await knowledgeItemService.deleteLeafDescendantItems(baseId, [itemId])

      const leaves = await commitPreparedKnowledgeItem({
        baseId,
        item,
        prepared,
        onCreatedItem: () => {},
        runMutation: async (task) => await task(),
        signal: ctx.signal
      })
      if (leaves.length === 0) {
        return []
      }

      await knowledgeItemService.updateStatus(itemId, 'processing')
      ctx.reportProgress(50, {
        stage: 'enqueuing',
        currentFile: 0,
        totalFiles: leaves.length
      })

      for (const [index, leaf] of leaves.entries()) {
        ctx.signal.throwIfAborted()
        await jobManager.enqueue(
          'knowledge.index-leaf',
          { baseId, itemId: leaf.id, parentJobId: ctx.jobId },
          {
            idempotencyKey: `knowledge:${baseId}:${leaf.id}`,
            parentId: ctx.jobId
          }
        )
        ctx.reportProgress(50 + Math.round(((index + 1) / Math.max(leaves.length, 1)) * 50), {
          stage: 'enqueuing',
          currentFile: index + 1,
          totalFiles: leaves.length
        })
      }

      return leaves
    })

    ctx.reportProgress(100, {
      stage: 'done',
      currentFile: leafItems.length,
      totalFiles: leafItems.length
    })
  },

  // Flip the container's status to 'failed' once retries exhaust or the job is
  // cancelled. Without this the container stays 'processing' (its phase is
  // 'preparing'); reconcileContainers' phase-non-null branch would also keep
  // every ancestor stuck.
  async onSettled(event) {
    if (event.status === 'completed') return

    const jobManager = application.get('JobManager')
    const snapshot = await jobManager.get(event.jobId)
    const input = snapshot?.input as { itemId?: string } | undefined
    if (!input?.itemId) return

    const reason = event.error?.message?.trim() || `Job ${event.status}`
    try {
      await knowledgeItemService.updateStatus(input.itemId, 'failed', { error: reason })
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) return
      logger.error(
        'Failed to flip knowledge container to failed in onSettled',
        error instanceof Error ? error : new Error(String(error)),
        { jobId: event.jobId, itemId: input.itemId }
      )
    }
  }
}
