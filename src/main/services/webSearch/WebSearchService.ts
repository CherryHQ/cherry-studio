import { loggerService } from '@logger'
import type { WebSearchRequest, WebSearchResponse } from '@shared/data/types/webSearch'

import { applyWebSearchPostProcessing } from './processing/postProcessor'
import { createWebSearchProvider } from './providers/factory'
import { clearWebSearchStatus, setWebSearchStatus } from './runtime/status'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'
import { getProviderById, getRuntimeConfig } from './utils/config'

const logger = loggerService.withContext('MainWebSearchService')

export class WebSearchService {
  private static instance: WebSearchService | null = null

  public static getInstance(): WebSearchService {
    if (!WebSearchService.instance) {
      WebSearchService.instance = new WebSearchService()
    }
    return WebSearchService.instance
  }

  private constructor() {}

  async search(request: WebSearchRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    try {
      const provider = await getProviderById(request.providerId)
      if (!provider) {
        throw new Error(`Unsupported or unavailable provider: ${request.providerId}`)
      }

      const runtimeConfig = await getRuntimeConfig()
      const questions = request.questions

      if (questions.length === 0) {
        return {
          query: '',
          results: []
        }
      }

      const providerDriver = createWebSearchProvider(provider)
      const searchPromises = questions.map((query) => providerDriver.search(query, runtimeConfig, httpOptions))

      const searchResults = await Promise.allSettled(searchPromises)
      const successfulSearchCount = searchResults.filter((item) => item.status === 'fulfilled').length
      const successfulSearches = searchResults.filter((i) => i.status === 'fulfilled')

      if (successfulSearchCount > 1) {
        await setWebSearchStatus(
          request.requestId,
          {
            phase: 'fetch_complete',
            countAfter: successfulSearchCount
          },
          1000
        )
      }

      if (successfulSearches.length === 0) {
        const firstRejected = searchResults.find((item) => item.status === 'rejected')
        throw firstRejected?.reason ?? new Error('Web search failed with no successful results')
      }

      const allResults = successfulSearches.flatMap((item) => item.value.results)

      const mergedResponse: WebSearchResponse = {
        query: questions.join(' | '),
        results: allResults
      }

      const filteredResponse = filterWebSearchResponseWithBlacklist(mergedResponse, runtimeConfig.excludeDomains)

      if (
        filteredResponse.results.length > 0 &&
        runtimeConfig.compression.method === 'cutoff' &&
        runtimeConfig.compression.cutoffLimit
      ) {
        await setWebSearchStatus(request.requestId, { phase: 'cutoff' }, 500)
      }
      // TODO RAG

      const processedResponse = applyWebSearchPostProcessing(filteredResponse, runtimeConfig)
      return processedResponse
    } catch (error) {
      logger.error('Web search failed', error as Error)
      throw error
    } finally {
      await clearWebSearchStatus(request.requestId)
    }
  }
}

export const webSearchService = WebSearchService.getInstance()
