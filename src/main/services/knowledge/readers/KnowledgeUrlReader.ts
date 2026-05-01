import { loggerService } from '@logger'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document, type Document as VectorStoreDocument } from '@vectorstores/core'

import { fetchKnowledgeWebPage } from '../utils/url'

const logger = loggerService.withContext('KnowledgeUrlReader')

export async function loadUrlDocuments(
  item: KnowledgeItemOf<'url'>,
  signal?: AbortSignal
): Promise<VectorStoreDocument[]> {
  const markdown = await fetchKnowledgeWebPage(item.data.url, signal)
  if (!markdown) {
    logger.warn('Knowledge URL reader received empty markdown', {
      itemId: item.id,
      sourceUrl: item.data.source
    })
    throw new Error(`Knowledge URL returned empty markdown: ${item.data.url}`)
  }

  return [
    new Document({
      text: markdown,
      metadata: {
        source: item.data.source
      }
    })
  ]
}
