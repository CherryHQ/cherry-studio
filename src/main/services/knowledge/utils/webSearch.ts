import { loggerService } from '@logger'
import { isValidUrl } from '@shared/utils'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'

const logger = loggerService.withContext('KnowledgeWebSearch')
const sitemapParser = new XMLParser()
const DEFAULT_FETCH_TIMEOUT_MS = 30000
const JINA_READER_BASE_URL = 'https://r.jina.ai/'

type ParsedSitemapDocument = {
  urlset?: { url?: Array<{ loc?: string }> | { loc?: string } }
}

export async function fetchKnowledgeWebPage(url: string): Promise<string> {
  try {
    if (!isValidUrl(url)) {
      throw new Error(`Invalid knowledge web url: ${url}`)
    }

    const response = await net.fetch(`${JINA_READER_BASE_URL}${url}`, {
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
      headers: {
        'X-Retain-Images': 'none',
        'X-Return-Format': 'markdown'
      }
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch knowledge web page ${url}: HTTP ${response.status}`)
    }

    const markdown = (await response.text()).trim()

    return markdown
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to load knowledge web page: ${url}`, normalizedError)
    throw error
  }
}

export async function fetchKnowledgeSitemapUrls(sitemapUrl: string): Promise<string[]> {
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

    const pageUrls = normalizeLocs(parsed.urlset?.url)
    if (pageUrls.length === 0) {
      logger.warn('Knowledge sitemap resolved no urls', {
        sitemapUrl
      })
      return []
    }
    logger.info('Knowledge sitemap page urls resolved', {
      sitemapUrl,
      urlCount: pageUrls.length
    })
    return pageUrls
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to load knowledge sitemap: ${sitemapUrl}`, normalizedError)
    throw error
  }
}

function normalizeLocs(value: Array<{ loc?: string }> | { loc?: string } | undefined): string[] {
  if (!value) {
    return []
  }

  const entries = Array.isArray(value) ? value : [value]
  return entries.map((entry) => entry.loc?.trim()).filter((loc): loc is string => Boolean(loc))
}
