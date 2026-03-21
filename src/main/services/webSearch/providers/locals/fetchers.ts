import { loggerService } from '@logger'

import { localBrowser } from './LocalBrowser'

const logger = loggerService.withContext('LocalWebSearchFetchers')
const DEFAULT_TIMEOUT_MS = 10000

function parseTimeout(_httpOptions?: RequestInit, fallback = DEFAULT_TIMEOUT_MS) {
  return fallback
}

async function fetchHtmlByBrowser(url: string, httpOptions?: RequestInit): Promise<string> {
  const timeout = parseTimeout(httpOptions, DEFAULT_TIMEOUT_MS)
  return localBrowser.fetchHtml(url, {
    timeoutMs: timeout,
    signal: httpOptions?.signal ?? undefined,
    showWindow: false
  })
}

export async function fetchSearchResultPageHtml(url: string, httpOptions?: RequestInit): Promise<string> {
  try {
    return await fetchHtmlByBrowser(url, httpOptions)
  } catch (error) {
    logger.error(`Failed to fetch search result page HTML: ${url}`, error as Error)
    throw error
  }
}
