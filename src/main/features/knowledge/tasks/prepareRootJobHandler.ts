import './jobTypes'

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import type { KnowledgeLockManager } from '../base/KnowledgeLockManager'
import type { KnowledgeIngestionService } from '../ingestion/KnowledgeIngestionService'
import { markUnscheduledKnowledgeItemsFailed } from '../ingestion/statusCleanup'
import { isIndexableKnowledgeItem } from '../items'
import { deleteKnowledgeItemFilesBestEffort } from '../pathStorage'
import { prepareKnowledgeItem } from '../pipeline/sources/prepare'
import { deleteKnowledgeItemVectors } from '../pipeline/vectorstore/vectorCleanup'
import { knowledgeQueueName, reportKnowledgeProgress, toKnowledgeBaseId, toKnowledgeItemId } from '../types'
import type { KnowledgePrepareRootPayload } from './jobTypes'
import { isDataApiNotFoundError, markKnowledgeItemFailedOnSettled } from './utils/settled'

const logger = loggerService.withContext('Knowledge:PrepareRootJobHandler')

export function createPrepareRootJobHandler(
  knowledgeLockManager: KnowledgeLockManager,
  ingestionService: KnowledgeIngestionService
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
    const item = knowledgeItemService.getById(itemId)

    if (item.status === 'deleting') {
      logger.info('Skipping prepare-root for deleting item', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
      return null
    }

    return item
  } catch (error) {
    if (isDataApiNotFoundError(error)) {
      logger.info('Skipping prepare-root for missing base or item', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'item-gone' })
      return null
    }
    throw error
  }
}

async function deletePreviousLeafExpansion(
  baseId: string,
  itemId: string,
  knowledgeLockManager: KnowledgeLockManager
): Promise<void> {
  await knowledgeLockManager.withBaseMutationLock(baseId, async () => {
    const base = knowledgeBaseService.getById(baseId)
    const descendants = knowledgeItemService.getSubtreeItems(baseId, [itemId])
    const removableDescendants = descendants.filter((item) => item.status !== 'deleting')
    const removableDescendantIds = removableDescendants.map((item) => item.id)
    const removableLeafIds = removableDescendants.filter(isIndexableKnowledgeItem).map((item) => item.id)

    await deleteKnowledgeItemVectors(base, removableLeafIds)
    // Best-effort: a file-removal failure must not abort the row deletion below.
    await deleteKnowledgeItemFilesBestEffort(baseId, removableDescendants, { baseId, itemId })
    knowledgeItemService.deleteItemsByIds(baseId, removableDescendantIds)
  })
}

async function scanRootItem(
  ctx: JobContext<KnowledgePrepareRootPayload>,
  knowledgeLockManager: KnowledgeLockManager
): Promise<KnowledgeItem[]> {
  const { baseId, itemId } = ctx.input

  return await knowledgeLockManager.withBaseMutationLock(baseId, async () => {
    let currentItem: KnowledgeItem
    try {
      currentItem = knowledgeItemService.getById(itemId)
    } catch (error) {
      if (isDataApiNotFoundError(error)) {
        logger.info('Skipping prepare-root for missing item before expansion', { baseId, itemId, jobId: ctx.jobId })
        reportKnowledgeProgress(ctx, 100, { stage: 'item-gone' })
        return []
      }
      throw error
    }

    if (currentItem.status === 'deleting') {
      logger.info('Skipping prepare-root for deleting item before expansion', { baseId, itemId, jobId: ctx.jobId })
      reportKnowledgeProgress(ctx, 100, { stage: 'deleting' })
      return []
    }

    const leaves = await prepareKnowledgeItem({
      baseId,
      item: currentItem,
      onCreatedItem: () => {},
      runMutation: async (task) => await task(),
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
  ingestionService: KnowledgeIngestionService
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
    logMessage: 'Failed to mark unscheduled knowledge child item after prepare-root scheduling failure',
    logContextKey: 'scheduleError'
  })
}
