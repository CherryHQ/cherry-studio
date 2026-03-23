import { loggerService } from '@logger'
import type { WebSearchExecutionConfig, WebSearchRequest, WebSearchResponse } from '@shared/data/types/webSearch'

import { postProcessWebSearchResponse } from './postProcessing'
import type { BaseWebSearchProvider } from './providers/base/BaseWebSearchProvider'
import { createWebSearchProvider } from './providers/factory'
import { clearWebSearchStatus, setWebSearchStatus } from './runtime/status'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'
import { getProviderById, getRuntimeConfig } from './utils/config'

const logger = loggerService.withContext('MainWebSearchService')

type PreparedWebSearchContext = {
  questions: WebSearchRequest['questions']
  runtimeConfig: WebSearchExecutionConfig
  providerDriver: BaseWebSearchProvider
}

export class WebSearchService {
  private static instance: WebSearchService | null = null

  public static getInstance(): WebSearchService {
    if (!WebSearchService.instance) {
      WebSearchService.instance = new WebSearchService()
    }
    return WebSearchService.instance
  }

  private constructor() {}

  private async prepareSearchContext(request: WebSearchRequest): Promise<PreparedWebSearchContext> {
    const [provider, runtimeConfig] = await Promise.all([getProviderById(request.providerId), getRuntimeConfig()])

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

  private async buildFinalResponse(
    request: WebSearchRequest,
    context: PreparedWebSearchContext,
    searchResults: PromiseSettledResult<WebSearchResponse>[]
  ): Promise<WebSearchResponse> {
    const successfulSearches = searchResults.filter((item) => item.status === 'fulfilled')

    if (successfulSearches.length > 1) {
      await setWebSearchStatus(
        request.requestId,
        {
          phase: 'fetch_complete',
          countAfter: successfulSearches.length
        },
        1000
      )
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
      await setWebSearchStatus(request.requestId, postProcessed.status, 500)
    }

    return postProcessed.response
  }

  async search(request: WebSearchRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    try {
      const context = await this.prepareSearchContext(request)
      const searchResults = await this.executeSearches(context, httpOptions)
      const finalResponse = await this.buildFinalResponse(request, context, searchResults)

      return finalResponse
    } catch (error) {
      logger.error('Web search failed', error as Error)
      throw error
    } finally {
      await clearWebSearchStatus(request.requestId)
    }
  }
}

export const webSearchService = WebSearchService.getInstance()
