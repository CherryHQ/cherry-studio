import { loggerService } from '@logger'
import type { KnowledgeItemOf } from '@shared/data/types/knowledge'
import type { Document } from '@vectorstores/core'
import PQueue from 'p-queue'

import { fetchKnowledgeSitemapUrls } from '../utils/webSearch'
import { loadUrlDocuments } from './KnowledgeUrlReader'

const logger = loggerService.withContext('KnowledgeSitemapReader')

export async function loadSitemapDocuments(item: KnowledgeItemOf<'sitemap'>): Promise<Document[]> {
  const sitemapReadQueue = new PQueue({
    concurrency: 3,
    intervalCap: 20,
    interval: 60_000
  })
  const urls = await fetchKnowledgeSitemapUrls(item.data.url)
  const uniqueUrls = Array.from(new Set(urls))
  const documents = await Promise.all(
    uniqueUrls.map(async (url) => {
      return await sitemapReadQueue.add(
        async () => {
          const urlItem: KnowledgeItemOf<'url'> = {
            ...item,
            type: 'url',
            data: {
              url,
              name: url
            }
          }

          return await loadUrlDocuments(urlItem)
        },
        { throwOnTimeout: true }
      )
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
