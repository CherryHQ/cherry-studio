import { loggerService } from '@logger'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import { Document, type Document as VectorStoreDocument } from '@vectorstores/core'

import { fetchKnowledgeWebPage } from '../utils/webSearch'
import type { KnowledgeReader } from './KnowledgeReader'

const logger = loggerService.withContext('KnowledgeUrlReader')

export class KnowledgeUrlReader implements KnowledgeReader<KnowledgeItemOf<'url'>> {
  async load(item: KnowledgeItemOf<'url'>): Promise<VectorStoreDocument[]> {
    const content = await fetchKnowledgeWebPage(item.data.url)
    const markdown = content.markdown.trim()
    if (!markdown) {
      logger.warn('Knowledge URL reader received empty markdown', {
        itemId: item.id,
        sourceUrl: item.data.url,
        name: item.data.name
      })
      return []
    }

    logger.info('Knowledge URL reader created document', {
      itemId: item.id,
      sourceUrl: content.url,
      name: item.data.name,
      markdownLength: markdown.length
    })

    return [
      new Document({
        text: markdown,
        metadata: {
          itemId: item.id,
          itemType: item.type,
          sourceUrl: content.url,
          name: item.data.name
        }
      })
    ]
  }
}
