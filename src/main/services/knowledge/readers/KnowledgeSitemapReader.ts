import { loggerService } from '@logger'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'

import { fetchKnowledgeSitemapUrls } from '../utils/webSearch'
import type { KnowledgeReader } from './KnowledgeReader'
import { KnowledgeUrlReader } from './KnowledgeUrlReader'

const logger = loggerService.withContext('KnowledgeSitemapReader')

export class KnowledgeSitemapReader implements KnowledgeReader<KnowledgeItemOf<'sitemap'>> {
  private readonly urlReader = new KnowledgeUrlReader()

  async load(item: KnowledgeItemOf<'sitemap'>): Promise<Document[]> {
    const urls = await fetchKnowledgeSitemapUrls(item.data.url)
    const uniqueUrls = Array.from(new Set(urls))
    const documents = await Promise.all(
      uniqueUrls.map(async (url) => {
        const urlItem: KnowledgeItemOf<'url'> = {
          ...item,
          type: 'url',
          data: {
            url,
            name: url
          }
        }

        return await this.urlReader.load(urlItem)
      })
    )

    const resolvedDocuments = documents.flat()

    logger.info('Knowledge sitemap reader completed', {
      itemId: item.id,
      sitemapUrl: item.data.url,
      resolvedUrlCount: uniqueUrls.length,
      documentCount: resolvedDocuments.length
    })

    return resolvedDocuments
  }
}
