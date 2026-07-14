import { loggerService } from '@logger'
import { isAbortError } from '@main/utils/error'
import { fetchRemoteText } from '@main/utils/remoteFetch'
import { Readability } from '@mozilla/readability'
import type { WebSearchResult } from '@shared/data/types/webSearch'
import { JSDOM } from 'jsdom'
import TurndownService from 'turndown'

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

export async function fetchWebSearchContent(url: string, httpOptions: RequestInit = {}): Promise<WebSearchResult> {
  try {
    // web_fetch is reachable from untrusted channel input and auto-allowed, so
    // direct main-process fetches must bind the connection to validated DNS results.
    const html = await fetchRemoteText(url, {
      headers: buildHeaders(httpOptions.headers),
      signal: httpOptions.signal ?? undefined
    })

    const dom = new JSDOM(html, { url: SAFE_JSDOM_URL })
    const article = new Readability(dom.window.document).parse()
    const markdown = turndownService.turndown(article?.content || '').trim()

    return {
      title: article?.title || url,
      url,
      content: markdown,
      sourceInput: url
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
