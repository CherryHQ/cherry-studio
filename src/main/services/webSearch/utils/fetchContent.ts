import { loggerService } from '@logger'
import { Readability } from '@mozilla/readability'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import { isValidUrl } from '@shared/utils'
import { net } from 'electron'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

import { localBrowser } from '../providers/locals/LocalBrowser'
import { isAbortError } from './errors'

const logger = loggerService.withContext('MainWebSearchContentFetcher')
const turndownService = new TurndownService()
const SAFE_JSDOM_URL = 'http://localhost/'

function buildHeaders(headers?: HeadersInit) {
  const resolvedHeaders = new Headers(headers)

  if (!resolvedHeaders.has('User-Agent')) {
    resolvedHeaders.set(
      'User-Agent',
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    )
  }

  return resolvedHeaders
}

export async function fetchWebSearchContent(
  url: string,
  usingBrowser: boolean,
  httpOptions: RequestInit = {}
): Promise<WebSearchResult> {
  try {
    if (!isValidUrl(url)) {
      throw new Error(`Invalid URL format: ${url}`)
    }

    let html: string

    if (usingBrowser) {
      html = await localBrowser.fetchHtml(url, { signal: httpOptions.signal ?? undefined })
    } else {
      const response = await net.fetch(url, {
        ...httpOptions,
        headers: buildHeaders(httpOptions.headers),
        signal: httpOptions.signal
          ? AbortSignal.any([httpOptions.signal, AbortSignal.timeout(30000)])
          : AbortSignal.timeout(30000)
      })

      if (!response.ok) {
        throw new Error(`HTTP error: ${response.status}`)
      }

      html = await response.text()
    }

    const dom = new JSDOM(html, { url: SAFE_JSDOM_URL })
    const article = new Readability(dom.window.document).parse()
    const markdown = turndownService.turndown(article?.content || '').trim()

    return {
      title: article?.title || url,
      url,
      content: markdown
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to fetch ${url}`, normalizedError)
    throw error
  }
}
