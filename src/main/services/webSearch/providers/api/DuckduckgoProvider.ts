import { loggerService } from '@logger'
import { isAbortError } from '@main/utils/error'
import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse, WebSearchResult } from '@shared/data/types/webSearch'
import { isHttpUrl } from '@shared/utils/url'
import * as cheerio from 'cheerio'
import { net } from 'electron'

import { fetchWebSearchContent } from '../../utils/fetchContent'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/'

const logger = loggerService.withContext('DuckduckgoProvider')

function decodeResultUrl(href: string): string {
  try {
    const normalized = href.startsWith('//') ? `https:${href}` : href
    const url = new URL(normalized)

    if (!url.pathname.includes('/l/')) {
      return href
    }

    const encodedUrl = url.searchParams.get('uddg')
    if (!encodedUrl) {
      return href
    }

    const decoded = decodeURIComponent(encodedUrl)
    return decoded.startsWith('http') ? decoded : href
  } catch {
    return href
  }
}

function parseSearchItems(html: string): { title: string; url: string }[] {
  const $ = cheerio.load(html)
  const items: { title: string; url: string }[] = []

  $('.result').each((_, element) => {
    const titleEl = $(element).find('.result__title a')
    const href = titleEl.attr('href')
    const title = titleEl.text().trim()
    if (!href || !title) {
      return
    }

    // Ad entries link through DuckDuckGo's ad script.
    if (href.includes('y.js')) {
      return
    }

    items.push({ title, url: decodeResultUrl(href) })
  })

  return items
}

export class DuckduckgoProvider extends BaseWebSearchProvider {
  async searchKeywords(
    query: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const signal = httpOptions?.signal ?? undefined
    const searchUrl = `${SEARCH_ENDPOINT}?q=${encodeURIComponent(query)}`
    const response = await net.fetch(searchUrl, {
      method: 'GET',
      headers: {
        ...defaultAppHeaders(),
        Accept: 'text/html'
      },
      signal
    })

    if (!response.ok) {
      await this.throwHttpError('Duckduckgo search failed', response)
    }

    const html = await response.text()
    const searchItems = parseSearchItems(html)
    const validItems = searchItems.filter((item) => isHttpUrl(item.url)).slice(0, config.maxResults)

    if (validItems.length === 0) {
      logger.warn('Duckduckgo search returned no usable results', { query, parsed: searchItems.length })
    }

    const settledResults = await Promise.allSettled(
      validItems.map((item) => fetchWebSearchContent(item.url, { signal }))
    )

    const rejectedResults = settledResults.filter((item): item is PromiseRejectedResult => item.status === 'rejected')

    const abortResult = rejectedResults.find((item) => isAbortError(item.reason))

    if (abortResult && signal?.aborted) {
      throw abortResult.reason
    }

    if (rejectedResults.length > 0) {
      logger.warn('Some Duckduckgo content fetches failed', {
        query,
        failedCount: rejectedResults.length,
        totalCount: validItems.length
      })
    }

    const fulfilledResults = settledResults.filter(
      (item): item is PromiseFulfilledResult<WebSearchResult> => item.status === 'fulfilled'
    )

    if (fulfilledResults.length === 0 && rejectedResults.length > 0) {
      throw rejectedResults[0].reason
    }

    return {
      query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [query],
      results: fulfilledResults
        .map((item) => item.value)
        .filter((item) => item.content.trim().length > 0)
        .map((item) => ({ ...item, sourceInput: query }))
    }
  }
}
