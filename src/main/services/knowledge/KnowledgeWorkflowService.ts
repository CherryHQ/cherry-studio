import './jobs/jobTypes'

import { application } from '@application'
import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'
import type { KnowledgeItem, KnowledgeRuntimeAddItemInput } from '@shared/data/types/knowledge'

import type { KnowledgeLockManager } from './KnowledgeLockManager'
import {
  type KnowledgeBaseId,
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeIndexIdempotencyKey,
  type KnowledgeItemId,
  knowledgePrepareIdempotencyKey,
  knowledgeQueueName,
  knowledgeReindexSubtreeIdempotencyKey,
  toKnowledgeBaseId,
  toKnowledgeItemId,
  toKnowledgeItemIds
} from './types'
import { markUnscheduledKnowledgeItemsFailed } from './utils/cleanup/statusCleanup'
import { isContainerKnowledgeItem } from './utils/items'
import { planKnowledgeItemSource } from './utils/sources/sourcePlanning'

const logger = loggerService.withContext('Knowledge:WorkflowService')

export class KnowledgeWorkflowService {
  constructor(private readonly knowledgeLockManager: KnowledgeLockManager) {}

  async addItems(baseId: string, inputs: KnowledgeRuntimeAddItemInput[]): Promise<void> {
    if (inputs.length === 0) {
      return
    }

    const base = await knowledgeBaseService.getById(baseId)
    const acceptedItems: KnowledgeItem[] = []

    await this.knowledgeLockManager.withBaseMutationLock(base.id, async () => {
      try {
        for (const input of inputs) {
          const createdItem = await knowledgeItemService.create(base.id, input)
          acceptedItems.push(createdItem)
          const activeItem = await knowledgeItemService.updateStatus(
            createdItem.id,
            isContainerKnowledgeItem(createdItem) ? 'preparing' : 'processing'
          )
          acceptedItems[acceptedItems.length - 1] = activeItem
        }
      } catch (error) {
        await this.rollbackAcceptedItems(base.id, acceptedItems, error)
        throw error
      }
    })

    const completedSchedulingItemIds = new Set<string>()
    try {
      for (const item of acceptedItems) {
        await this.scheduleItem(toKnowledgeBaseId(item.baseId), toKnowledgeItemId(item.id))
        completedSchedulingItemIds.add(item.id)
      }
    } catch (error) {
      await this.markUnscheduledAcceptedItemsFailed(base.id, acceptedItems, completedSchedulingItemIds, error)
      throw error
    }
  }

  async deleteItems(baseId: string, itemIds: string[]): Promise<void> {
    await knowledgeBaseService.getById(baseId)
    const rootItemIds = [...new Set(itemIds)]
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeRootItemIds = toKnowledgeItemIds(rootItemIds)
    const markedIds = await this.knowledgeLockManager.withBaseMutationLock(baseId, () =>
      knowledgeItemService.setSubtreeStatus(baseId, rootItemIds, 'deleting')
    )
    try {
      const jobManager = application.get('JobManager')
      await jobManager.enqueue(
        'knowledge.delete-subtree',
        { baseId, rootItemIds },
        {
          idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(knowledgeBaseId, knowledgeRootItemIds),
          queue: knowledgeQueueName(knowledgeBaseId)
        }
      )
    } catch (error) {
      logger.error('Failed to enqueue knowledge delete cleanup after marking items deleting', error as Error, {
        baseId,
        rootItemIds,
        markedIds
      })
      throw error
    }
  }

  async reindexItems(baseId: string, itemIds: string[]): Promise<void> {
    await knowledgeBaseService.getById(baseId)
    const rootItemIds = [...new Set(itemIds)]
    const knowledgeBaseId = toKnowledgeBaseId(baseId)
    const knowledgeRootItemIds = toKnowledgeItemIds(rootItemIds)
    const jobManager = application.get('JobManager')
    await jobManager.enqueue(
      'knowledge.reindex-subtree',
      { baseId, rootItemIds },
      {
        idempotencyKey: knowledgeReindexSubtreeIdempotencyKey(knowledgeBaseId, knowledgeRootItemIds),
        queue: knowledgeQueueName(knowledgeBaseId)
      }
    )
  }

  async scheduleItem(
    baseId: KnowledgeBaseId,
    itemId: KnowledgeItemId,
    parentJobId: string | null = null
  ): Promise<void> {
    const item = await knowledgeItemService.getById(itemId)
    if (item.baseId !== baseId) {
      throw new Error(`Knowledge item '${itemId}' does not belong to base '${baseId}'`)
    }
    if (item.status === 'deleting') {
      return
    }

    const plan = planKnowledgeItemSource(item)
    if (plan.kind === 'invalid') {
      await knowledgeItemService.updateStatus(itemId, 'failed', { error: plan.reason })
      return
    }

    const jobManager = application.get('JobManager')
    if (plan.kind === 'prepare-root') {
      await jobManager.enqueue(
        'knowledge.prepare-root',
        { baseId, itemId },
        {
          idempotencyKey: knowledgePrepareIdempotencyKey(baseId, itemId),
          queue: knowledgeQueueName(baseId),
          parentId: parentJobId ?? undefined
        }
      )
      return
    }

    await jobManager.enqueue(
      'knowledge.index-documents',
      { baseId, itemId },
      {
        idempotencyKey: knowledgeIndexIdempotencyKey(baseId, itemId),
        queue: knowledgeQueueName(baseId),
        parentId: parentJobId ?? undefined
      }
    )
  }

  private async rollbackAcceptedItems(baseId: string, items: KnowledgeItem[], originalError: unknown): Promise<void> {
    for (const item of items) {
      try {
        await knowledgeItemService.delete(item.id)
      } catch (cleanupError) {
        logger.error(
          'Failed to rollback accepted knowledge item after addItems failure',
          cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)),
          {
            baseId,
            itemId: item.id,
            addError: originalError instanceof Error ? originalError.message : String(originalError)
          }
        )
      }
    }
  }

  private async markUnscheduledAcceptedItemsFailed(
    baseId: string,
    items: KnowledgeItem[],
    completedSchedulingItemIds: Set<string>,
    originalError: unknown
  ): Promise<void> {
    const message = originalError instanceof Error ? originalError.message : String(originalError)
    await markUnscheduledKnowledgeItemsFailed({
      baseId,
      items,
      completedItemIds: completedSchedulingItemIds,
      errorMessage: message,
      failedStatusError: `Failed to schedule knowledge item job: ${message}`,
      logger,
      logMessage: 'Failed to mark unscheduled knowledge item after addItems scheduling failure',
      logContextKey: 'scheduleError'
    })
  }
}
