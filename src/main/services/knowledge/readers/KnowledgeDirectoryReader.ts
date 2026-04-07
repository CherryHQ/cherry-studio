import { loggerService } from '@logger'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

const logger = loggerService.withContext('KnowledgeDirectoryReader')

export async function loadDirectoryDocuments(item: KnowledgeItemOf<'directory'>): Promise<Document[]> {
  // Directory items are container-only placeholders for UI/rendering. Callers are expected
  // to flatten them into concrete child items before indexing, so this branch is a guard rail.
  logger.warn(`KnowledgeDirectoryReader will skip item: ${item.id}`)
  return []
}
