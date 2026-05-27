import './jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobContext, JobHandler } from '@main/core/job/types'
import { ErrorCode, isDataApiError } from '@shared/data/api'
import type { KnowledgeItem } from '@shared/data/types/knowledge'

import type { KnowledgeMutationCoordinator } from '../KnowledgeMutationCoordinator'
import type { KnowledgeWorkflowCoordinator } from '../KnowledgeWorkflowCoordinator'
import { knowledgeQueueName } from '../types'
import { detachKnowledgeItemFileRefs } from '../utils/cleanup/artifactCleanup'
import { deleteKnowledgeItemVectors } from '../utils/cleanup/vectorCleanup'
import { isIndexableKnowledgeItem } from '../utils/items'
import { prepareKnowledgeItem } from '../utils/sources/prepare'
import type { KnowledgePrepareRootPayload } from './jobTypes'

const logger = loggerService.withContext('Knowledge:PrepareRootJobHandler')

export function createPrepareRootJobHandler(
  mutationCoordinator: KnowledgeMutationCoordinator,
  workflowCoordinator: KnowledgeWorkflowCoordinator
): JobHandler<KnowledgePrepareRootPayload> {
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
      const { baseId, itemId } = ctx.input

      ctx.signal.throwIfAborted()
      // Validate the container before destructive cleanup; delete-base/delete-items can remove it first.
      const item = await loadPrepareRootItemOrSkip(ctx)
      if (!item) {
        return
      }

      // Drop stale expanded leaves from a previous attempt before scanning the source again.
      await deletePreviousLeafExpansion(baseId, itemId, mutationCoordinator)

      ctx.signal.throwIfAborted()
      ctx.reportProgress(0, { stage: 'scanning' })

      // Source expansion creates child items, so it runs under the base mutation lock.
      const leafItems = await scanRootItem(ctx, mutationCoordinator)
      // Child indexing is scheduled after expansion succeeds so partial scans do not enqueue stale leaves.
      await enqueueLeafItems(ctx, leafItems, workflowCoordinator)
    },

    async onSettled(event) {
      if (event.status === 'completed') return

      const jobManager = application.get('JobManager')
      const snapshot = await jobManager.get(event.jobId)
      const input = snapshot?.input as { itemId?: string } | undefined
      if (!input?.itemId) return

      const reason = event.error?.message?.trim() || `Job ${event.status}`
      try {
        const item = await knowledgeItemService.getById(input.itemId)
        if (item.status === 'deleting') return

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
}

async function loadPrepareRootItemOrSkip(ctx: JobContext<KnowledgePrepareRootPayload>): Promise<KnowledgeItem | null> {
  const { baseId, itemId } = ctx.input

  try {
    await knowledgeBaseService.getById(baseId)
    const item = await knowledgeItemService.getById(itemId)

    if (item.status === 'deleting') {
      logger.info('Skipping prepare-root for deleting item', { baseId, itemId, jobId: ctx.jobId })
      ctx.reportProgress(100, { stage: 'deleting' })
      return null
    }

    return item
  } catch (error) {
    if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
      logger.info('Skipping prepare-root for missing base or item', { baseId, itemId, jobId: ctx.jobId })
      ctx.reportProgress(100, { stage: 'item-gone' })
      return null
    }
    throw error
  }
}

async function deletePreviousLeafExpansion(
  baseId: string,
  itemId: string,
  mutationCoordinator: KnowledgeMutationCoordinator
): Promise<void> {
  await mutationCoordinator.withBaseMutationLock(baseId, async () => {
    const base = await knowledgeBaseService.getById(baseId)
    const descendants = await knowledgeItemService.getSubtreeItems(baseId, [itemId])
    const removableDescendants = descendants.filter((item) => item.status !== 'deleting')
    const removableDescendantIds = removableDescendants.map((item) => item.id)
    const removableLeafIds = removableDescendants.filter(isIndexableKnowledgeItem).map((item) => item.id)

    await deleteKnowledgeItemVectors(base, removableLeafIds)
    await detachKnowledgeItemFileRefs(removableDescendantIds)
    await knowledgeItemService.hardDeleteItems(baseId, removableDescendantIds)
  })
}

async function scanRootItem(
  ctx: JobContext<KnowledgePrepareRootPayload>,
  mutationCoordinator: KnowledgeMutationCoordinator
): Promise<KnowledgeItem[]> {
  const { baseId, itemId } = ctx.input

  return await mutationCoordinator.withBaseMutationLock(baseId, async () => {
    let currentItem: KnowledgeItem
    try {
      currentItem = await knowledgeItemService.getById(itemId)
    } catch (error) {
      if (isDataApiError(error) && error.code === ErrorCode.NOT_FOUND) {
        logger.info('Skipping prepare-root for missing item before expansion', { baseId, itemId, jobId: ctx.jobId })
        ctx.reportProgress(100, { stage: 'item-gone' })
        return []
      }
      throw error
    }

    if (currentItem.status === 'deleting') {
      logger.info('Skipping prepare-root for deleting item before expansion', { baseId, itemId, jobId: ctx.jobId })
      ctx.reportProgress(100, { stage: 'deleting' })
      return []
    }

    const leaves = await prepareKnowledgeItem({
      baseId,
      item: currentItem,
      onCreatedItem: () => {},
      runMutation: async (task) => await task(),
      signal: ctx.signal
    })
    await knowledgeItemService.updateStatus(itemId, 'processing')
    return leaves
  })
}

async function enqueueLeafItems(
  ctx: JobContext<KnowledgePrepareRootPayload>,
  leafItems: KnowledgeItem[],
  workflowCoordinator: KnowledgeWorkflowCoordinator
): Promise<void> {
  const { baseId } = ctx.input

  ctx.reportProgress(50, { stage: 'enqueuing', currentFile: 0, totalFiles: leafItems.length })
  const completedSchedulingLeafIds = new Set<string>()
  for (const [index, leaf] of leafItems.entries()) {
    ctx.signal.throwIfAborted()
    try {
      await workflowCoordinator.scheduleItem(baseId, leaf.id, ctx.jobId)
      completedSchedulingLeafIds.add(leaf.id)
    } catch (error) {
      await markUnscheduledLeafItemsFailed(baseId, leafItems, completedSchedulingLeafIds, error)
      throw error
    }
    ctx.reportProgress(50 + Math.round(((index + 1) / Math.max(leafItems.length, 1)) * 50), {
      stage: 'enqueuing',
      currentFile: index + 1,
      totalFiles: leafItems.length
    })
  }

  ctx.reportProgress(100, { stage: 'done', currentFile: leafItems.length, totalFiles: leafItems.length })
}

async function markUnscheduledLeafItemsFailed(
  baseId: string,
  leafItems: KnowledgeItem[],
  completedSchedulingLeafIds: Set<string>,
  originalError: unknown
): Promise<void> {
  const message = originalError instanceof Error ? originalError.message : String(originalError)
  for (const leaf of leafItems) {
    if (completedSchedulingLeafIds.has(leaf.id)) {
      continue
    }

    try {
      await knowledgeItemService.updateStatus(leaf.id, 'failed', {
        error: `Failed to schedule knowledge child item job: ${message}`
      })
    } catch (cleanupError) {
      logger.error(
        'Failed to mark unscheduled knowledge child item after prepare-root scheduling failure',
        cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
        {
          baseId,
          itemId: leaf.id,
          scheduleError: message
        }
      )
    }
  }
}
