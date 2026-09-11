import { loggerService } from '@logger'
import { defaultAppHeaders } from '@main/utils/http'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'
import { isHttpUrl } from '@shared/utils/url'
import * as cheerio from 'cheerio'
import { net } from 'electron'

import { fetchSearchResultContents } from '../../utils/fetchContent'
import { BaseWebSearchProvider } from '../base/BaseWebSearchProvider'

const SEARCH_ENDPOINT = 'https://html.duckduckgo.com/html/'

const logger = loggerService.withContext('DuckduckgoProvider')

/** DDG serves bot-detection challenges with 200/202, so the body is the only reliable signal. */
function isAnomalyPage(html: string): boolean {
  return html.includes('anomaly-modal') || html.includes('anomaly.js')
}

function decodeResultUrl(href: string): string {
  try {
    const normalized = href.startsWith('//') ? `https:${href}` : href
    const url = new URL(normalized)

    if (!url.pathname.includes('/l/')) {
      return href
    }

    // URLSearchParams already percent-decoded the target; decoding again would corrupt it.
    const target = url.searchParams.get('uddg')
    return target?.startsWith('http') ? target : href
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

    // Challenge interstitials carry no .result blocks, so gate on a zero parse to
    // avoid flagging results that merely mention the anomaly markers.
    if (searchItems.length === 0 && isAnomalyPage(html)) {
      throw new Error('Duckduckgo search blocked by a bot-detection challenge page')
    }

    const validItems = searchItems.filter((item) => isHttpUrl(item.url)).slice(0, config.maxResults)

    if (validItems.length === 0) {
      logger.warn('Duckduckgo search returned no usable results', { query, parsed: searchItems.length })
    }

    const results = await fetchSearchResultContents(
      validItems.map((item) => item.url),
      { query, providerLabel: 'Duckduckgo', signal }
    )

    return {
      query,
      providerId: this.provider.id,
      capability: 'searchKeywords',
      inputs: [query],
      results: results.map((item) => ({ ...item, sourceInput: query }))
    }
  }
}
