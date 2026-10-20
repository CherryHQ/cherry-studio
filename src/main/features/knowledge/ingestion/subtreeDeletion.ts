import { chunk } from 'es-toolkit'

import { application } from '@application'
import type { DbOrTx } from '@data/db/types'
import { knowledgeItemService } from '@data/services/KnowledgeItemService'
import { loggerService } from '@logger'

import {
  knowledgeDeleteSubtreeIdempotencyKey,
  knowledgeQueueName,
  toKnowledgeBaseId,
  toKnowledgeItemIds
} from '../types'

const logger = loggerService.withContext('Knowledge:SubtreeDeletion')
const DELETE_ROOT_CHUNK_SIZE = 500

export function enqueueKnowledgeSubtreeDeletionTx(tx: DbOrTx, baseId: string, rootItemIds: string[]): void {
  const uniqueRootItemIds = [...new Set(rootItemIds)]
  if (uniqueRootItemIds.length === 0) {
    return
  }

  const knowledgeBaseId = toKnowledgeBaseId(baseId)
  for (const rootIds of chunk(uniqueRootItemIds, DELETE_ROOT_CHUNK_SIZE)) {
    const knowledgeRootItemIds = toKnowledgeItemIds(rootIds)
    application.get('JobManager').enqueueTx(
      tx,
      'knowledge.delete-subtree',
      { baseId, rootItemIds: rootIds },
      {
        idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(knowledgeBaseId, knowledgeRootItemIds),
        queue: knowledgeQueueName(knowledgeBaseId)
      }
    )
  }
}

export function recoverDeletingKnowledgeItems(
  baseId?: string,
  excludedRootItemIds: ReadonlySet<string> = new Set()
): void {
  let deletingRootGroups: ReturnType<typeof knowledgeItemService.getDeletingRootGroups>
  try {
    deletingRootGroups = knowledgeItemService.getDeletingRootGroups()
  } catch (error) {
    logger.error('Failed to scan deleting knowledge items for recovery', error as Error)
    return
  }

  for (const group of deletingRootGroups) {
    if (baseId && group.baseId !== baseId) {
      continue
    }
    const recoverableRootItemIds = group.rootItemIds.filter((itemId) => !excludedRootItemIds.has(itemId))
    for (let index = 0; index < recoverableRootItemIds.length; index += DELETE_ROOT_CHUNK_SIZE) {
      const rootItemIds = recoverableRootItemIds.slice(index, index + DELETE_ROOT_CHUNK_SIZE)
      try {
        application
          .get('DbService')
          .withWriteTx((tx) => enqueueKnowledgeSubtreeDeletionTx(tx, group.baseId, rootItemIds))
      } catch (error) {
        logger.error('Failed to enqueue recovered knowledge delete cleanup', error as Error, {
          baseId: group.baseId,
          rootItemIds
        })
      }
    }
  }
}
