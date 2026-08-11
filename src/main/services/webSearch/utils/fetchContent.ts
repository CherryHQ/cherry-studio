import { loggerService } from '@logger'
import { readableContentService } from '@main/services/readableContent'
import { isAbortError } from '@main/utils/error'
import { fetchRemoteText } from '@main/utils/remoteFetch'
import type { WebSearchResult } from '@shared/data/types/webSearch'

const logger = loggerService.withContext('MainWebSearchContentFetcher')

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

    const article = await readableContentService.extractReadableMarkdown(html, {
      signal: httpOptions.signal ?? undefined
    })

    return {
      title: article.title || url,
      url,
      content: article.content,
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
