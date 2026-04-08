import { loggerService } from '@logger'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

const logger = loggerService.withContext('KnowledgeSitemapReader')

export async function loadSitemapDocuments(item: KnowledgeItemOf<'sitemap'>): Promise<Document[]> {
  // Sitemap items are container-only placeholders. Callers are expected to expand
  // them into concrete url items before invoking the reader/indexing pipeline.
  logger.warn(`KnowledgeSitemapReader will skip item: ${item.id}`)
  return []
}
