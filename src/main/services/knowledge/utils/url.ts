import { loggerService } from '@logger'
import { isValidUrl } from '@shared/utils'
import { net } from 'electron'
import PQueue from 'p-queue'

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

/**
 * Fetches a knowledge web page through the Jina reader endpoint and returns
 * the normalized markdown payload.
 */
export async function fetchKnowledgeWebPage(url: string): Promise<string> {
  try {
    if (!isValidUrl(url)) {
      throw new Error(`Invalid knowledge web url: ${url}`)
    }

    const response = await knowledgeWebFetchQueue.add(
      async () =>
        await net.fetch(`${JINA_READER_BASE_URL}${url}`, {
          signal: AbortSignal.timeout(DEFAULT_FETCH_TIMEOUT_MS),
          headers: {
            'X-Retain-Images': 'none',
            'X-Return-Format': 'markdown'
          }
        })
    )
    if (!response) {
      throw new Error(`Knowledge web fetch queue returned no response for ${url}`)
    }

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
