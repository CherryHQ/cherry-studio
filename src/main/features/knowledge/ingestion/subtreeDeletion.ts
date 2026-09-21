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
const DELETE_RECOVERY_ROOT_CHUNK_SIZE = 500

export function enqueueKnowledgeSubtreeDeletionTx(tx: DbOrTx, baseId: string, rootItemIds: string[]): void {
  const uniqueRootItemIds = [...new Set(rootItemIds)]
  if (uniqueRootItemIds.length === 0) {
    return
  }

  const knowledgeBaseId = toKnowledgeBaseId(baseId)
  const knowledgeRootItemIds = toKnowledgeItemIds(uniqueRootItemIds)
  application.get('JobManager').enqueueTx(
    tx,
    'knowledge.delete-subtree',
    { baseId, rootItemIds: uniqueRootItemIds },
    {
      idempotencyKey: knowledgeDeleteSubtreeIdempotencyKey(knowledgeBaseId, knowledgeRootItemIds),
      queue: knowledgeQueueName(knowledgeBaseId)
    }
  )
}

export function recoverDeletingKnowledgeItems(baseId?: string): void {
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
    for (let index = 0; index < group.rootItemIds.length; index += DELETE_RECOVERY_ROOT_CHUNK_SIZE) {
      const rootItemIds = group.rootItemIds.slice(index, index + DELETE_RECOVERY_ROOT_CHUNK_SIZE)
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
