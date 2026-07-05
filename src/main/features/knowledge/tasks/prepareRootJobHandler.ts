import './jobTypes'

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KeyedMutex } from '@main/core/concurrency/KeyedMutex'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { removeDir } from '@main/utils/file'
import { isDataApiNotFoundError } from '@shared/data/api/errors'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import type { KnowledgeItemScheduler } from '../ingestion/KnowledgeIngestionService'
import { markUnscheduledKnowledgeItemsFailed } from '../ingestion/statusCleanup'
import { purgeKnowledgeSubtreeWithinLock } from '../ingestion/subtreePurge'
import { getKnowledgeBaseFilePath } from '../pathStorage'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgePrepareRootPayload } from './jobTypes'
import { prepareKnowledgeItem } from './prepareItem'
import { resolveLiveKnowledgeItem } from './utils/liveItem'
import { markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:PrepareRootJobHandler')

export function createPrepareRootJobHandler(
  knowledgeLockManager: KeyedMutex,
  ingestionService: KnowledgeItemScheduler
): JobHandler<KnowledgePrepareRootPayload> {
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
      const { baseId, itemId } = ctx.input

      ctx.signal.throwIfAborted()
      // Validate the container before destructive cleanup; delete-base/delete-items can remove it first.
      const item = loadPrepareRootItemOrSkip(ctx)
      if (!item) {
        return
      }

      // Drop stale expanded leaves before scanning so first attempts and retries stay idempotent.
      await deletePreviousLeafExpansion(baseId, itemId, knowledgeLockManager)

      ctx.signal.throwIfAborted()
      reportKnowledgeProgress(ctx, 0, { stage: 'scanning' })

      // Source expansion creates child items, so it runs under the base mutation lock.
      const leafItems = await scanRootItem(ctx, knowledgeLockManager)
      // Child indexing is scheduled after expansion succeeds so partial scans do not enqueue stale leaves.
      await enqueueLeafItems(ctx, leafItems, ingestionService)
    },

    async onSettled(event) {
      await markKnowledgeItemFailedOnSettled(event, logger, 'Failed to flip knowledge container to failed in onSettled')
    }
  }
}

function loadPrepareRootItemOrSkip(ctx: JobContext<KnowledgePrepareRootPayload>): KnowledgeItem | null {
  const { baseId, itemId } = ctx.input

  try {
    knowledgeBaseService.getById(baseId)
  } catch (error) {
    if (isDataApiNotFoundError(error)) {
      logger.info('Skipping prepare-root for missing base or item', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'item-gone' })
      return null
    }
    throw error
  }

  const result = resolveLiveKnowledgeItem(itemId)
  if ('skip' in result) {
    if (result.skip === 'deleting') {
      logger.info('Skipping prepare-root for deleting item', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
    } else {
      logger.info('Skipping prepare-root for missing base or item', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'item-gone' })
    }
    return null
  }

  return result.item
}

async function deletePreviousLeafExpansion(
  baseId: string,
  itemId: string,
  knowledgeLockManager: KeyedMutex
): Promise<void> {
  await knowledgeLockManager.runExclusive(baseId, async () => {
    const base = knowledgeBaseService.getById(baseId)
    const descendants = knowledgeItemService.getSubtreeItems(baseId, [itemId])
    const removableDescendants = descendants.filter((item) => item.status !== 'deleting')
    await purgeKnowledgeSubtreeWithinLock(base, removableDescendants, { baseId, itemId })

    // `getSubtreeItems` excludes the container row, so the purge above never touches the
    // container's own `raw/<pathPrefix>` shell. A prior attempt pins `relativePath` before
    // copying any byte (see prepareDirectoryForRuntime), so if orphan bytes exist the row
    // records their prefix — reclaim the whole shell here. removeDir is idempotent (ENOENT
    // no-op) when the shell was never created.
    const result = resolveLiveKnowledgeItem(itemId)
    if ('item' in result && result.item.type === 'directory') {
      const prefix = result.item.data.relativePath
      if (prefix) {
        await removeDir(getKnowledgeBaseFilePath(baseId, prefix))
      }
    }
  })
}

async function scanRootItem(
  ctx: JobContext<KnowledgePrepareRootPayload>,
  knowledgeLockManager: KeyedMutex
): Promise<KnowledgeItem[]> {
  const { baseId, itemId } = ctx.input

  return await knowledgeLockManager.runExclusive(baseId, async () => {
    const result = resolveLiveKnowledgeItem(itemId)
    if ('skip' in result) {
      if (result.skip === 'deleting') {
        logger.info('Skipping prepare-root for deleting item before expansion', { baseId, itemId, jobId: ctx.jobId })
        reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
      } else {
        logger.info('Skipping prepare-root for missing item before expansion', { baseId, itemId, jobId: ctx.jobId })
        reportKnowledgeProgress(ctx, 100, { stage: 'item-gone' })
      }
      return []
    }

    const leaves = await prepareKnowledgeItem({
      baseId,
      item: result.item,
      signal: ctx.signal
    })
    if (leaves.length > 0) {
      knowledgeItemService.updateStatus(itemId, 'processing')
    }
    return leaves
  })
}

async function enqueueLeafItems(
  ctx: JobContext<KnowledgePrepareRootPayload>,
  leafItems: KnowledgeItem[],
  ingestionService: KnowledgeItemScheduler
): Promise<void> {
  const { baseId } = ctx.input

  reportKnowledgeProgress(ctx, 50, { stage: 'enqueuing', currentFile: 0, totalFiles: leafItems.length })
  const completedSchedulingLeafIds = new Set<string>()
  const baseIdInput = toKnowledgeBaseId(baseId)
  for (const [index, leaf] of leafItems.entries()) {
    ctx.signal.throwIfAborted()
    try {
      await ingestionService.scheduleItem(baseIdInput, toKnowledgeItemId(leaf.id), ctx.jobId)
      completedSchedulingLeafIds.add(leaf.id)
    } catch (error) {
      markUnscheduledLeafItemsFailed(baseId, leafItems, completedSchedulingLeafIds, error)
      throw error
    }
    reportKnowledgeProgress(ctx, 50 + Math.round(((index + 1) / Math.max(leafItems.length, 1)) * 50), {
      stage: 'enqueuing',
      currentFile: index + 1,
      totalFiles: leafItems.length
    })
  }

  reportKnowledgeProgress(ctx, 100, { stage: 'done', currentFile: leafItems.length, totalFiles: leafItems.length })
}

function markUnscheduledLeafItemsFailed(
  baseId: string,
  leafItems: KnowledgeItem[],
  completedSchedulingLeafIds: Set<string>,
  originalError: unknown
): void {
  const message = originalError instanceof Error ? originalError.message : String(originalError)
  markUnscheduledKnowledgeItemsFailed({
    baseId,
    items: leafItems,
    completedItemIds: completedSchedulingLeafIds,
    errorMessage: message,
    failedStatusError: `Failed to schedule knowledge child item job: ${message}`,
    logger,
    logMessage: 'Failed to mark unscheduled knowledge child item after prepare-root scheduling failure'
  })
}
