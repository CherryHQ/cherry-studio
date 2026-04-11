import { loggerService } from '@logger'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import type { KnowledgeItem } from '@shared/data/types/knowledge'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'

import { sanitizeKnowledgeUrl } from './url'

const logger = loggerService.withContext('KnowledgeSitemapExpansion')
const DEFAULT_FETCH_TIMEOUT_MS = 30000
const sitemapParser = new XMLParser()

type ParsedSitemapDocument = {
  urlset?: { url?: Array<{ loc?: string }> | { loc?: string } }
}

/**
 * Normalizes sitemap url entries into a flat string list.
 */
function normalizeLocs(value: Array<{ loc?: string }> | { loc?: string } | undefined): string[] {
  if (!value) {
    return []
  }

  const entries = Array.isArray(value) ? value : [value]
  return entries.map((entry) => entry.loc?.trim()).filter((loc): loc is string => Boolean(loc))
}

/**
 * Expands a sitemap owner item into child url items fetched from the remote
 * sitemap document.
 */
export async function expandSitemapOwnerToCreateItems(owner: KnowledgeItem): Promise<CreateKnowledgeItemsDto['items']> {
  if (owner.type !== 'sitemap') {
    throw new Error(`Knowledge item '${owner.id}' must be type 'sitemap', received '${owner.type}'`)
  }

  const sitemapUrl = owner.data.url

  try {
    const safeSitemapUrl = sanitizeKnowledgeUrl(sitemapUrl)

    const response = await net.fetch(safeSitemapUrl, {
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
    })

    if (!response.ok) {
      throw new Error(`Failed to read sitemap ${safeSitemapUrl}: HTTP ${response.status}`)
    }

    const xml = await response.text()
    const parsed = sitemapParser.parse(xml) as ParsedSitemapDocument
    const pageUrls = [...new Set(normalizeLocs(parsed.urlset?.url).map((url) => sanitizeKnowledgeUrl(url)))]

    if (pageUrls.length === 0) {
      logger.warn('Sitemap expansion produced no URLs', {
        ownerId: owner.id,
        sitemapUrl: safeSitemapUrl
      })
    }

    return pageUrls.map((url) => ({
      groupId: owner.id,
      type: 'url' as const,
      data: {
        url,
        name: url
      }
    }))
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to expand sitemap: ${sitemapUrl}`, normalizedError)
    throw error
  }
}
