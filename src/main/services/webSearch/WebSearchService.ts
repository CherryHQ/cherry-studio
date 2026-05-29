import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type {
  WebSearchExecutionConfig,
  WebSearchFetchUrlsRequest,
  WebSearchResponse,
  WebSearchSearchKeywordsRequest
} from '@shared/data/types/webSearch'
import { IpcChannel } from '@shared/IpcChannel'

import { postProcessWebSearchResponse } from './postProcessing'
import type { WebSearchProviderDriver } from './providers/factory'
import { createWebSearchProvider } from './providers/factory'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'
import { getProviderForCapability, getRuntimeConfig } from './utils/config'
import { isAbortError } from './utils/errors'
import { normalizeWebSearchKeywords, normalizeWebSearchUrls } from './utils/input'
import { ApiKeyRotationState } from './utils/provider'

const logger = loggerService.withContext('MainWebSearchService')

type RunCapabilityRequest = {
  providerId?: WebSearchProvider['id']
  capability: WebSearchCapability
  inputs: string[]
}

type PreparedWebSearchContext = {
  inputs: string[]
  runtimeConfig: WebSearchExecutionConfig
  provider: WebSearchProvider
  providerDriver: WebSearchProviderDriver
  capability: WebSearchCapability
}

@Injectable('WebSearchService')
@ServicePhase(Phase.WhenReady)
export class WebSearchService extends BaseService {
  // Service-scoped state preserves API key rotation across IPC calls and is cleared on stop.
  private readonly apiKeyRotationState = new ApiKeyRotationState()

  protected onInit(): void {
    this.registerDisposable(() => this.apiKeyRotationState.clear())
    this.registerIpcHandlers()
  }

  private registerIpcHandlers(): void {
    this.ipcHandle(IpcChannel.WebSearch_SearchKeywords, (_, request: WebSearchSearchKeywordsRequest) =>
      this.searchKeywords(request)
    )
    this.ipcHandle(IpcChannel.WebSearch_FetchUrls, (_, request: WebSearchFetchUrlsRequest) => this.fetchUrls(request))
  }

  private async prepareContext(request: RunCapabilityRequest): Promise<PreparedWebSearchContext> {
    const preferenceService = application.get('PreferenceService')
    const [provider, runtimeConfig] = await Promise.all([
      getProviderForCapability(request.providerId, request.capability, preferenceService),
      getRuntimeConfig(preferenceService)
    ])

    const providerDriver = createWebSearchProvider(provider, this.apiKeyRotationState)

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
    searchResults: PromiseSettledResult<WebSearchResponse>[],
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    const abortedSearch = searchResults.find(
      (item): item is PromiseRejectedResult => item.status === 'rejected' && isAbortError(item.reason)
    )

    // Only caller-aborted requests cancel the whole fanout; provider-side abort-like failures stay partial.
    if (abortedSearch && httpOptions?.signal?.aborted) {
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
      results: successfulSearches.flatMap((item) => item.value.results)
    }

    const filteredResponse = filterWebSearchResponseWithBlacklist(mergedResponse, context.runtimeConfig.excludeDomains)
    const postProcessed = await postProcessWebSearchResponse(filteredResponse, context.runtimeConfig)

    return postProcessed.response
  }

  private async runCapability(request: RunCapabilityRequest, httpOptions?: RequestInit): Promise<WebSearchResponse> {
    let context: PreparedWebSearchContext | undefined

    try {
      context = await this.prepareContext(request)
      const searchResults = await this.executeCapability(context, httpOptions)
      return await this.buildFinalResponse(context, searchResults, httpOptions)
    } catch (error) {
      if (!isAbortError(error) || !httpOptions?.signal?.aborted) {
        const normalizedError = error instanceof Error ? error : new Error(String(error))
        logger.error('Web search failed', normalizedError, {
          providerId: context?.provider.id ?? request.providerId,
          capability: context?.capability ?? request.capability
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
