import { loggerService } from '@logger'
import type { CreateKnowledgeItemDto, KnowledgeItemOf } from '@shared/data/types/knowledge'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'

import { sanitizeKnowledgeUrl } from './url'

const logger = loggerService.withContext('KnowledgeSitemapExpansion')
const DEFAULT_SITEMAP_FETCH_TIMEOUT_MS = 30000
const sitemapParser = new XMLParser()

type ParsedSitemapDocument = {
  urlset?: { url?: Array<{ loc?: string }> | { loc?: string } }
}
type SitemapUrlChildInput = Extract<CreateKnowledgeItemDto, { type: 'url' }>

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
export async function expandSitemapOwnerToCreateItems(
  owner: KnowledgeItemOf<'sitemap'>,
  signal: AbortSignal
): Promise<SitemapUrlChildInput[]> {
  const sitemapUrl = owner.data.url

  try {
    const safeSitemapUrl = sanitizeKnowledgeUrl(sitemapUrl)
    signal.throwIfAborted()

    const response = await net.fetch(safeSitemapUrl, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(DEFAULT_SITEMAP_FETCH_TIMEOUT_MS)])
    })
    signal.throwIfAborted()

    if (!response.ok) {
      throw new Error(`Failed to read sitemap ${safeSitemapUrl}: HTTP ${response.status}`)
    }

    const xml = await response.text()
    signal.throwIfAborted()
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
        source: url,
        url
      }
    }))
  } catch (error) {
    if (signal.aborted) {
      throw error
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to expand sitemap: ${sitemapUrl}`, normalizedError)
    throw error
  }
}
