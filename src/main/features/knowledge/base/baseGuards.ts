import { knowledgeBaseService } from '@data/services/KnowledgeBaseService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

/**
 * A base in `failed` state must be restored before any runtime operation (search, add, reindex,
 * deep-read). Returns the fetched base so synchronous callers need not re-fetch it.
 */
export function assertBaseCanRunRuntimeOperation(baseId: string, operation: string): KnowledgeBase {
  const base = knowledgeBaseService.getById(baseId)

  if (base.status !== 'failed') {
    return base
  }

  throw DataApiErrorFactory.validation(
    {
      base: [`Knowledge base '${baseId}' is in failed state; restore it before ${operation}.`]
    },
    `Cannot ${operation} failed knowledge base`
  )
}
