import { loggerService } from '@logger'
import { Readability } from '@mozilla/readability'
import { isValidUrl } from '@shared/utils'
import { net } from 'electron'
import { XMLParser } from 'fast-xml-parser'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

export interface KnowledgeWebPageContent {
  url: string
  title?: string
  markdown: string
}

const logger = loggerService.withContext('KnowledgeWebSearch')
const sitemapParser = new XMLParser()
const turndownService = new TurndownService()
const DEFAULT_FETCH_TIMEOUT_MS = 30000
const MAX_SITEMAP_DEPTH = 3

type ParsedSitemapDocument = {
  urlset?: { url?: Array<{ loc?: string }> | { loc?: string } }
  sitemapindex?: { sitemap?: Array<{ loc?: string }> | { loc?: string } }
}

export async function fetchKnowledgeWebPage(url: string): Promise<KnowledgeWebPageContent> {
  try {
    if (!isValidUrl(url)) {
      throw new Error(`Invalid knowledge web url: ${url}`)
    }

    logger.info('Knowledge web fetch started', {
      url
    })

    const response = await net.fetch(url, {
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
    })

    if (!response.ok) {
      throw new Error(`Failed to fetch knowledge web page ${url}: HTTP ${response.status}`)
    }

    const html = await response.text()
    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    const rawContent = article?.content?.trim() || dom.window.document.body?.innerHTML || ''
    const markdown = turndownService.turndown(rawContent).trim()
    const title = article?.title?.trim() || dom.window.document.title?.trim() || undefined

    if (!markdown) {
      logger.warn('Knowledge web fetch returned empty markdown', {
        url,
        title
      })
    } else {
      logger.info('Knowledge web fetch succeeded', {
        url,
        title,
        markdownLength: markdown.length
      })
    }

    return {
      url,
      title,
      markdown
    }
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to load knowledge web page: ${url}`, normalizedError)
    throw error
  }
}

export async function fetchKnowledgeSitemapUrls(sitemapUrl: string, depth: number = 0): Promise<string[]> {
  try {
    if (!isValidUrl(sitemapUrl)) {
      throw new Error(`Invalid knowledge sitemap url: ${sitemapUrl}`)
    }

    if (depth > MAX_SITEMAP_DEPTH) {
      throw new Error(`Sitemap nesting is too deep: ${sitemapUrl}`)
    }

    logger.info('Knowledge sitemap fetch started', {
      sitemapUrl,
      depth
    })

    const response = await net.fetch(sitemapUrl, {
      signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS)
    })
    if (!response.ok) {
      throw new Error(`Failed to read sitemap ${sitemapUrl}: HTTP ${response.status}`)
    }

    const xml = await response.text()
    const parsed = sitemapParser.parse(xml) as ParsedSitemapDocument

    const pageUrls = normalizeLocs(parsed.urlset?.url)
    if (pageUrls.length > 0) {
      logger.info('Knowledge sitemap page urls resolved', {
        sitemapUrl,
        depth,
        urlCount: pageUrls.length
      })
      return pageUrls
    }

    const nestedSitemapUrls = normalizeLocs(parsed.sitemapindex?.sitemap)
    if (nestedSitemapUrls.length > 0) {
      logger.info('Knowledge sitemap nested indexes resolved', {
        sitemapUrl,
        depth,
        sitemapCount: nestedSitemapUrls.length
      })

      const nestedUrls = await Promise.all(nestedSitemapUrls.map((url) => fetchKnowledgeSitemapUrls(url, depth + 1)))
      return nestedUrls.flat()
    }

    logger.warn('Knowledge sitemap resolved no urls', {
      sitemapUrl,
      depth
    })
    return []
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
