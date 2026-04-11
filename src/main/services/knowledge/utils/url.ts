import { loggerService } from '@logger'
import { net } from 'electron'
import PQueue from 'p-queue'
import { sanitizeUrl } from 'strict-url-sanitise'

const logger = loggerService.withContext('KnowledgeWebSearch')
const DEFAULT_FETCH_TIMEOUT_MS = 30000
const JINA_READER_BASE_URL = 'https://r.jina.ai/'
const KNOWLEDGE_WEB_FETCH_CONCURRENCY = 3
const KNOWLEDGE_WEB_FETCH_INTERVAL_CAP = 10
const KNOWLEDGE_WEB_FETCH_INTERVAL_MS = 60_000

const knowledgeWebFetchQueue = new PQueue({
  concurrency: KNOWLEDGE_WEB_FETCH_CONCURRENCY,
  intervalCap: KNOWLEDGE_WEB_FETCH_INTERVAL_CAP,
  interval: KNOWLEDGE_WEB_FETCH_INTERVAL_MS
})

export function sanitizeKnowledgeUrl(rawUrl: string): string {
  try {
    const sanitizedUrl = sanitizeUrl(rawUrl)
    const parsedRawUrl = new URL(rawUrl)

    if (parsedRawUrl.pathname === '/' && !rawUrl.endsWith('/') && !parsedRawUrl.search && !parsedRawUrl.hash) {
      return sanitizedUrl.replace(/\/$/, '')
    }

    return sanitizedUrl
  } catch {
    throw new Error(`Invalid knowledge url: ${rawUrl}`)
  }
}

/**
 * Fetches a knowledge web page through the Jina reader endpoint and returns
 * the normalized markdown payload.
 */
export async function fetchKnowledgeWebPage(url: string, signal?: AbortSignal): Promise<string> {
  try {
    const safeUrl = sanitizeKnowledgeUrl(url)

    const response = await knowledgeWebFetchQueue.add(
      async () =>
        await net.fetch(`${JINA_READER_BASE_URL}${safeUrl}`, {
          signal: signal ?? AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
          headers: {
            'X-Retain-Images': 'none',
            'X-Return-Format': 'markdown'
          }
        }),
      signal ? { signal } : undefined
    )
    if (!response) {
      throw new Error(`Knowledge web fetch queue returned no response for ${safeUrl}`)
    }

    if (!response.ok) {
      throw new Error(`Failed to fetch knowledge web page ${safeUrl}: HTTP ${response.status}`)
    }

    const markdown = (await response.text()).trim()

    return markdown
  } catch (error) {
    const normalizedError = error instanceof Error ? error : new Error(String(error))
    logger.error(`Failed to load knowledge web page: ${url}`, normalizedError)
    throw error
  }
}
