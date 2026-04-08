import { loggerService } from '@logger'
import type { CreateKnowledgeItemsDto } from '@shared/data/api/schemas/knowledges'
import { isValidUrl } from '@shared/utils'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'

const logger = loggerService.withContext('KnowledgeSitemapExpansion')
const DEFAULT_FETCH_TIMEOUT_MS = 30000
const sitemapParser = new XMLParser()

type ParsedSitemapDocument = {
  urlset?: { url?: Array<{ loc?: string }> | { loc?: string } }
}

function normalizeLocs(value: Array<{ loc?: string }> | { loc?: string } | undefined): string[] {
  if (!value) {
    return []
  }

  const entries = Array.isArray(value) ? value : [value]
  return entries.map((entry) => entry.loc?.trim()).filter((loc): loc is string => Boolean(loc))
}

export async function expandSitemapToCreateItems(sitemapUrl: string): Promise<CreateKnowledgeItemsDto['items']> {
  try {
    if (!isValidUrl(sitemapUrl)) {
      throw new Error(`Invalid knowledge sitemap url: ${sitemapUrl}`)
    }

    const response = await net.fetch(sitemapUrl, {
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
    })

    if (!response.ok) {
      throw new Error(`Failed to read sitemap ${sitemapUrl}: HTTP ${response.status}`)
    }

    const xml = await response.text()
    const parsed = sitemapParser.parse(xml) as ParsedSitemapDocument
    const pageUrls = [...new Set(normalizeLocs(parsed.urlset?.url))]

    return [
      {
        ref: 'root',
        type: 'sitemap',
        data: {
          url: sitemapUrl,
          name: sitemapUrl
        }
      },
      ...pageUrls.map((url) => ({
        groupRef: 'root',
        type: 'url' as const,
        data: {
          url,
          name: url
        }
      }))
    ]
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to expand sitemap: ${sitemapUrl}`, normalizedError)
    throw error
  }
}
