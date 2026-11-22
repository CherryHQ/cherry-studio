import { application } from '@application'

import { knowledgeIndexIdempotencyKey, knowledgeQueueName, type KnowledgeBaseId, type KnowledgeItemId } from '../types'

export function enqueueKnowledgeIndexing(
  baseId: KnowledgeBaseId,
  itemId: KnowledgeItemId,
  parentJobId: string | null = null
): void {
  application.get('JobManager').enqueue(
    'knowledge.index-documents',
    { baseId, itemId },
    {
      idempotencyKey: knowledgeIndexIdempotencyKey(baseId, itemId, parentJobId),
      queue: knowledgeQueueName(baseId),
      parentId: parentJobId ?? undefined
    }
  )
}
