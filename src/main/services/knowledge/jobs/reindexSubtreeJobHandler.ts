import './jobTypes'

import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { JobHandler } from '@main/core/job/types'

import type { KnowledgeMutationCoordinator } from '../KnowledgeMutationCoordinator'
import type { KnowledgeWorkflowCoordinator } from '../KnowledgeWorkflowCoordinator'
import { knowledgeQueueName } from '../types'
import { deleteKnowledgeItemVectors } from '../utils/cleanup/vectorCleanup'
import { isContainerKnowledgeItem, isIndexableKnowledgeItem } from '../utils/items'
import type { KnowledgeReindexSubtreePayload } from './jobTypes'

const logger = loggerService.withContext('Knowledge:ReindexSubtreeJobHandler')

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

      // Reindex is admitted only for completed/failed subtrees, but delete may win
      // after enqueue. Keep this fast path so delete remains the only preemptive action.
      if (await shouldSkipDeletingSubtreeReindex(baseId, rootItemIds, ctx.jobId)) {
        ctx.reportProgress(100, { stage: 'deleting' })
        return
      }

      // Reset vectors, expanded children, and root statuses as one base-level mutation.
      const resetResult = await mutationCoordinator.withBaseMutationLock(baseId, async () => {
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

        const leafRootIds = selectedRoots.filter((item) => isIndexableKnowledgeItem(item)).map((item) => item.id)
        if (leafRootIds.length > 0) {
          await knowledgeItemService.detachFileRefs(leafRootIds)
        }

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
        // Roots are already visible as active after reset. If scheduling the durable
        // follow-up job fails, flip them to failed so the UI does not show stuck work.
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
