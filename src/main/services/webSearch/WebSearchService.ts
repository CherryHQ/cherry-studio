import { application } from '@application'
import { loggerService } from '@logger'
import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchFetchUrlsRequest,
  WebSearchResponse,
  WebSearchSearchKeywordsRequest
} from '@shared/data/types/webSearch'

import { postProcessWebSearchResponse } from './postProcessing'
import type { WebSearchProviderDriver } from './providers/factory'
import { assertWebSearchProviderSupportsCapability, createWebSearchProvider } from './providers/factory'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'
import { getProviderForCapability, getRuntimeConfig } from './utils/config'
import { isAbortError } from './utils/errors'
import { normalizeWebSearchKeywords, normalizeWebSearchUrls } from './utils/input'

const logger = loggerService.withContext('MainWebSearchService')

type RunCapabilityRequest = {
  providerId?: ResolvedWebSearchProvider['id']
  capability: WebSearchCapability
  inputs: string[]
}

type PreparedWebSearchContext = {
  inputs: string[]
  runtimeConfig: WebSearchExecutionConfig
  provider: ResolvedWebSearchProvider
  providerDriver: WebSearchProviderDriver
  capability: WebSearchCapability
}

class WebSearchService {
  private async prepareContext(request: RunCapabilityRequest): Promise<PreparedWebSearchContext> {
    const preferenceService = application.get('PreferenceService')
    const [provider, runtimeConfig] = await Promise.all([
      getProviderForCapability(request.providerId, request.capability, preferenceService),
      getRuntimeConfig(preferenceService)
    ])

    assertWebSearchProviderSupportsCapability(provider, request.capability)

    const providerDriver = createWebSearchProvider(provider)
    if (typeof providerDriver[request.capability] !== 'function') {
      throw new Error(`Web search provider ${provider.id} does not implement capability ${request.capability}`)
    }

    return {
      inputs: request.inputs,
      runtimeConfig,
      provider,
      providerDriver,
      capability: request.capability
    }
  }

  private async executeCapability(
    context: PreparedWebSearchContext,
    httpOptions?: RequestInit
  ): Promise<PromiseSettledResult<WebSearchResponse>[]> {
    const capabilityRunner = context.providerDriver[context.capability]

    if (!capabilityRunner) {
      throw new Error(`Web search provider ${context.provider.id} does not implement capability ${context.capability}`)
    }

    return Promise.allSettled(
      context.inputs.map((input) =>
        capabilityRunner.call(context.providerDriver, input, context.runtimeConfig, httpOptions)
      )
    )
  }

  private async buildFinalResponse(
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
        logger.warn('Partial web search input failed', {
          providerId: context.provider.id,
          capability: context.capability,
          input: context.inputs[index],
          error: item.reason instanceof Error ? item.reason.message : String(item.reason)
        })
      }
    })

    const successfulSearches = searchResults.filter(
      (item): item is PromiseFulfilledResult<WebSearchResponse> => item.status === 'fulfilled'
    )

    if (successfulSearches.length === 0) {
      const firstRejected = searchResults.find((item) => item.status === 'rejected')
      throw firstRejected?.reason ?? new Error('Web search failed with no successful results')
    }

    const mergedResponse: WebSearchResponse = {
      query: context.inputs.join(' | '),
      providerId: context.provider.id,
      capability: context.capability,
      inputs: context.inputs,
      results: successfulSearches.flatMap((item, index) =>
        item.value.results.map((result) => ({
          ...result,
          sourceInput: result.sourceInput || item.value.inputs[0] || context.inputs[index] || ''
        }))
      )
    }

    const filteredResponse = filterWebSearchResponseWithBlacklist(mergedResponse, context.runtimeConfig.excludeDomains)
    const postProcessed = await postProcessWebSearchResponse(filteredResponse, context.runtimeConfig)

    return postProcessed.response
  }

  private async runCapability(request: RunCapabilityRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    const context = await this.prepareContext(request)

    try {
      const searchResults = await this.executeCapability(context, httpOptions)
      return await this.buildFinalResponse(context, searchResults)
    } catch (error) {
      if (!isAbortError(error)) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Web search failed', normalizedError, {
          providerId: context.provider.id,
          capability: context.capability
        })
      }
      throw error
    }
  }

  async searchKeywords(request: WebSearchSearchKeywordsRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    return this.runCapability(
      {
        providerId: request.providerId,
        capability: 'searchKeywords',
        inputs: normalizeWebSearchKeywords(request.keywords)
      },
      httpOptions
    )
  }

  async fetchUrls(request: WebSearchFetchUrlsRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    return this.runCapability(
      {
        providerId: request.providerId,
        capability: 'fetchUrls',
        inputs: normalizeWebSearchUrls(request.urls)
      },
      httpOptions
    )
  }
}

export const webSearchService = new WebSearchService()
