import { loggerService } from '@logger'
import { application } from '@main/core/application'
import type {
  WebSearchExecutionConfig,
  WebSearchRequest,
  WebSearchResponse,
  WebSearchStatus
} from '@shared/data/types/webSearch'

import { postProcessWebSearchResponse } from './postProcessing'
import type { BaseWebSearchProvider } from './providers/base/BaseWebSearchProvider'
import { createWebSearchProvider } from './providers/factory'
import { clearWebSearchStatus, setWebSearchStatus } from './runtime/status'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'
import { getProviderById, getRuntimeConfig } from './utils/config'
import { isAbortError } from './utils/errors'

const logger = loggerService.withContext('MainWebSearchService')

type PreparedWebSearchContext = {
  questions: WebSearchRequest['questions']
  runtimeConfig: WebSearchExecutionConfig
  providerDriver: BaseWebSearchProvider
}

class WebSearchService {
  private async prepareSearchContext(request: WebSearchRequest): Promise<PreparedWebSearchContext> {
    const preferenceService = application.get('PreferenceService')
    const [provider, runtimeConfig] = await Promise.all([
      getProviderById(request.providerId, preferenceService),
      getRuntimeConfig(preferenceService)
    ])

    return {
      questions: request.questions,
      runtimeConfig,
      providerDriver: createWebSearchProvider(provider)
    }
  }

  private async executeSearches(
    context: PreparedWebSearchContext,
    httpOptions?: RequestInit
  ): Promise<PromiseSettledResult<WebSearchResponse>[]> {
    const searchPromises = context.questions.map((query) =>
      context.providerDriver.search(query, context.runtimeConfig, httpOptions)
    )

    return Promise.allSettled(searchPromises)
  }

  private getSearchCompletionStatus(totalCount: number, successCount: number): WebSearchStatus | undefined {
    if (successCount === 0) {
      return undefined
    }

    if (successCount < totalCount) {
      return {
        phase: 'partial_failure',
        countBefore: totalCount,
        countAfter: successCount
      }
    }

    if (successCount > 1) {
      return {
        phase: 'fetch_complete',
        countAfter: successCount
      }
    }

    return undefined
  }

  private async buildFinalResponse(
    request: WebSearchRequest,
    context: PreparedWebSearchContext,
    searchResults: PromiseSettledResult<WebSearchResponse>[]
  ): Promise<WebSearchResponse> {
    const abortedSearch = searchResults.find(
      (item): item is PromiseRejectedResult => item.status === 'rejected' && isAbortError(item.reason)
    )

    if (abortedSearch) {
      throw abortedSearch.reason
    }

    searchResults.forEach((item, index) => {
      if (item.status === 'rejected') {
        logger.warn('Partial web search query failed', {
          requestId: request.requestId,
          query: context.questions[index],
          error: item.reason instanceof Error ? item.reason.message : String(item.reason)
        })
      }
    })

    const successfulSearches = searchResults.filter(
      (item): item is PromiseFulfilledResult<WebSearchResponse> => item.status === 'fulfilled'
    )
    const searchCompletionStatus = this.getSearchCompletionStatus(searchResults.length, successfulSearches.length)

    if (searchCompletionStatus) {
      await this.updateWebSearchStatus(request.requestId, searchCompletionStatus, 1000)
    }

    if (successfulSearches.length === 0) {
      const firstRejected = searchResults.find((item) => item.status === 'rejected')
      throw firstRejected?.reason ?? new Error('Web search failed with no successful results')
    }

    const mergedResponse: WebSearchResponse = {
      query: context.questions.join(' | '),
      results: successfulSearches.flatMap((item) => item.value.results)
    }

    const filteredResponse = filterWebSearchResponseWithBlacklist(mergedResponse, context.runtimeConfig.excludeDomains)

    const postProcessed = await postProcessWebSearchResponse(filteredResponse, context.runtimeConfig)

    if (postProcessed.status) {
      await this.updateWebSearchStatus(request.requestId, postProcessed.status, 500)
    }

    return postProcessed.response
  }

  private async updateWebSearchStatus(requestId: string, status: WebSearchStatus, delayMs?: number): Promise<void> {
    try {
      const cacheService = application.get('CacheService')
      await setWebSearchStatus(cacheService, requestId, status, delayMs)
    } catch (error) {
      logger.warn('Failed to update web search status', {
        requestId,
        phase: status.phase,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async clearWebSearchStatusSafely(requestId: string): Promise<void> {
    try {
      const cacheService = application.get('CacheService')
      await clearWebSearchStatus(cacheService, requestId)
    } catch (error) {
      logger.warn('Failed to clear web search status', {
        requestId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  async search(request: WebSearchRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    try {
      const context = await this.prepareSearchContext(request)
      const searchResults = await this.executeSearches(context, httpOptions)
      const finalResponse = await this.buildFinalResponse(request, context, searchResults)

      return finalResponse
    } catch (error) {
      if (!isAbortError(error)) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Web search failed', normalizedError, {
          requestId: request.requestId,
          providerId: request.providerId
        })
      }
      throw error
    } finally {
      await this.clearWebSearchStatusSafely(request.requestId)
    }
  }
}

export const webSearchService = new WebSearchService()
