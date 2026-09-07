import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobContext, JobHandler, JobSettledEvent } from '@main/core/job/types'
import { ACTIVE_JOB_STATUSES, type JobSnapshot } from '@shared/data/api/schemas/jobs'
import {
  KNOWLEDGE_ITEM_ERROR_INDEXING_INTERRUPTED,
  type KnowledgeItem,
  type KnowledgeItemStatus
} from '@shared/data/types/knowledge'

import type { KnowledgeItemScheduler } from '../ingestion/KnowledgeIngestionService'
import { canKnowledgeItemReacquireSource, isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../items'
import { deleteKnowledgeItemFilesBestEffort } from '../pathStorage'
import {
  type KnowledgeReacquireProducer,
  type KnowledgeReacquireWrite,
  resolveKnowledgeReacquireProducer
} from '../pipeline/sources/reacquire'
import { deleteKnowledgeItemVectors } from '../pipeline/vectorstore/vectorCleanup'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgeReindexSubtreePayload } from './jobTypes'
import { directoryCopyProgressCacheKey } from './utils/directoryCopyProgress'
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
      const cacheService = application.get('CacheService')
      ctx.signal.throwIfAborted()
      logger.info('Running knowledge reindex-subtree reset', { baseId, rootItemIds, jobId: ctx.jobId })

      // Reindex is admitted only for completed/failed subtrees, but delete may win
      // after enqueue. Keep this fast path so delete remains the only preemptive action.
      const liveRoots = resolveReindexableRoots(baseId, rootItemIds, ctx.jobId)
      if (!liveRoots) {
        reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
        return
      }

      // Re-acquire each leaf root from its real source (a file re-copies the user's original, a url
      // re-fetches, a note rewrites its snapshot from data.content) before the reset touches
      // anything. The slow half runs here, off the base lock; the writes it hands back overwrite the
      // items' pinned raw/ paths inside the lock below.
      const reacquireWrites = await produceReacquireWrites(ctx, baseId, liveRoots)

      // Reset vectors, expanded children, and root statuses as one base-level mutation.
      const resetResult = await knowledgeLockManager.runExclusive(baseId, async () => {
        // Re-acquisition and the wait for this lock are the long stretches; a cancel landing in
        // either must not still spend the reset. Checked only here — mid-reset checks would trade
        // this for a half-applied one, and once a root is activated recovery already covers it.
        ctx.signal.throwIfAborted()
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
          if (await canKnowledgeItemReacquireSource(root)) {
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

        // Activate every root before anything destructive runs. `completed` is the one status no
        // recovery path revisits — not `onSettled`, not the boot sweep — so a root left there while
        // its bytes are replaced or its vectors deleted would keep claiming an index it no longer has.
        for (const root of rebuildableRoots) {
          if (root.type === 'directory') {
            cacheService.deleteShared(directoryCopyProgressCacheKey(root.id))
          }
          knowledgeItemService.updateStatus(root.id, root.type === 'directory' ? 'preparing' : 'processing')
        }

        // Land the re-acquired bytes on the pinned raw/ paths before the index is torn down. Both
        // writes commit via tmp+rename, so a failure here leaves the previous bytes and index intact.
        for (const root of rebuildableRoots) {
          await reacquireWrites.get(root.id)?.(ctx.signal)
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
          // The re-acquired bytes made any pinned processed artifact stale, so a file that runs
          // through the processor must run through it again rather than index the old .md.
          await ingestionService.scheduleItem(toKnowledgeBaseId(baseId), toKnowledgeItemId(item.id), ctx.jobId, {
            forceFileReprocess: true
          })
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

/** The selected root items, or null when the subtree is being deleted and reindex must stand down. */
function resolveReindexableRoots(baseId: string, rootItemIds: string[], jobId: string): KnowledgeItem[] | null {
  const result = resolveLiveKnowledgeSubtree(baseId, rootItemIds)
  if ('skip' in result) {
    logger.info('Skipping reindex-subtree for deleting subtree', { baseId, rootItemIds, jobId })
    return null
  }
  return result.items.filter((item) => rootItemIds.includes(item.id))
}

/**
 * Run every selected leaf root's re-acquisition producer (url fetch, note content check) off the
 * base mutation lock, keyed by item id for the writes to be applied under it. Producers run
 * concurrently: serialized, a bulk refresh costs the sum of every page's fetch latency against a
 * retryable job timeout, and `fetchKnowledgeWebPage`'s own queue bounds the request rate either way.
 *
 * A genuine failure fails the job loudly — but first flips that root to `failed`, because it is
 * still `completed`/`failed` here and `markReindexSubtreeFailedOnSettled` only picks up roots the
 * reset already activated; without this a refresh click would appear to do nothing. Each root is
 * recorded as its own producer settles, so a dead page keeps its diagnosis instead of inheriting
 * whatever a sibling did, and an abort — which touches nothing — leaves every root `completed` on
 * its intact index rather than dropping it out of search (`query/visibility.ts`).
 */
async function produceReacquireWrites(
  ctx: JobContext<KnowledgeReindexSubtreePayload>,
  baseId: string,
  roots: KnowledgeItem[]
): Promise<Map<string, KnowledgeReacquireWrite>> {
  const producers = roots
    .filter(isIndexableKnowledgeItem)
    .map((item) => ({ itemId: item.id, produce: resolveKnowledgeReacquireProducer(item) }))
    .filter((entry): entry is { itemId: string; produce: KnowledgeReacquireProducer } => entry.produce !== null)

  ctx.signal.throwIfAborted()
  const settled = await Promise.allSettled(
    producers.map(async ({ itemId, produce }) => {
      try {
        return { itemId, write: await produce(ctx.signal) }
      } catch (error) {
        if (!ctx.signal.aborted) {
          knowledgeItemService.setSubtreeStatus(baseId, [itemId], 'failed', {
            error: error instanceof Error ? error.message : String(error)
          })
        }
        throw error
      }
    })
  )

  const writes = new Map<string, KnowledgeReacquireWrite>()
  const failures: unknown[] = []
  for (const result of settled) {
    if (result.status === 'fulfilled') {
      writes.set(result.value.itemId, result.value.write)
    } else {
      failures.push(result.reason)
    }
  }
  if (failures.length > 0) {
    // Only one reason reaches the job record, so log the whole batch: a single dead link and an
    // expired provider key are indistinguishable from that one message alone.
    logger.error(
      `Knowledge re-acquisition failed for ${failures.length}/${producers.length} roots`,
      failures[0] instanceof Error ? failures[0] : new Error(String(failures[0])),
      {
        baseId,
        jobId: ctx.jobId,
        reasons: failures.map((reason) => (reason instanceof Error ? reason.message : String(reason)))
      }
    )
    throw failures[0]
  }
  return writes
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
