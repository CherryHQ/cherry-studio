import { loggerService } from '@logger'
import { Readability } from '@mozilla/readability'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import { net } from 'electron'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

import { localBrowser } from '../providers/locals/LocalBrowser'

const logger = loggerService.withContext('MainWebSearchContentFetcher')
const turndownService = new TurndownService()

export const noContent = 'No content found'

function isValidUrl(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function isAbortError(error: unknown): boolean {
  return !!(error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'AbortError')
}

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
      html = await localBrowser.fetchHtml(url, {
        signal: httpOptions.signal ?? undefined,
        showWindow: false
      })
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

    const dom = new JSDOM(html, { url })
    const article = new Readability(dom.window.document).parse()
    const markdown = turndownService.turndown(article?.content || '')

    return {
      title: article?.title || url,
      url,
      content: markdown || noContent
    }
  } catch (error) {
    if (isAbortError(error)) {
      throw error
    }

    logger.error(`Failed to fetch ${url}`, error as Error)
    return {
      title: url,
      url,
      content: noContent
    }
  }
}
