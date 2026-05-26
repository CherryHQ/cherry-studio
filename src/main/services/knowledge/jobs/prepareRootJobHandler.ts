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
      const leafItems = await scanRootItem(ctx, item, mutationCoordinator)
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
    const descendants = await knowledgeItemService.getSubtreeItems(baseId, [itemId])
    await knowledgeItemService.hardDeleteItems(
      baseId,
      descendants.map((item) => item.id)
    )
  })
}

async function scanRootItem(
  ctx: JobContext<KnowledgePrepareRootPayload>,
  item: KnowledgeItem,
  mutationCoordinator: KnowledgeMutationCoordinator
): Promise<KnowledgeItem[]> {
  const { baseId, itemId } = ctx.input

  return await mutationCoordinator.withBaseMutationLock(baseId, async () => {
    const leaves = await prepareKnowledgeItem({
      baseId,
      item,
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
  for (const [index, leaf] of leafItems.entries()) {
    ctx.signal.throwIfAborted()
    await workflowCoordinator.scheduleItem(baseId, leaf.id, ctx.jobId)
    ctx.reportProgress(50 + Math.round(((index + 1) / Math.max(leafItems.length, 1)) * 50), {
      stage: 'enqueuing',
      currentFile: index + 1,
      totalFiles: leafItems.length
    })
  }

  ctx.reportProgress(100, { stage: 'done', currentFile: leafItems.length, totalFiles: leafItems.length })
}
