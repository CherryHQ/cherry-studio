import { loggerService } from '@logger'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document, type Document as VectorStoreDocument } from '@vectorstores/core'

import { fetchKnowledgeWebPage } from '../utils/url'

const logger = loggerService.withContext('KnowledgeUrlReader')

export async function loadUrlDocuments(item: KnowledgeItemOf<'url'>): Promise<VectorStoreDocument[]> {
  const markdown = await fetchKnowledgeWebPage(item.data.url)
  if (!markdown) {
    logger.warn('Knowledge URL reader received empty markdown', {
      itemId: item.id,
      sourceUrl: item.data.url,
      name: item.data.name
    })
    return []
  }

  return [
    new Document({
      text: markdown,
      metadata: {
        itemId: item.id,
        itemType: item.type,
        sourceUrl: item.data.url,
        name: item.data.name
      }
    })
  ]
}
