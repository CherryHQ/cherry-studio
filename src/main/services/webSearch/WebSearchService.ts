import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isAbortError } from '@main/utils/error'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import { TraceMethod } from '@mcp-trace/trace-core'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type {
  WebSearchExecutionConfig,
  WebSearchFetchUrlsRequest,
  WebSearchResponse,
  WebSearchSearchKeywordsRequest
} from '@shared/data/types/webSearch'

import { postProcessWebSearchResponse } from './postProcessing'
import type { WebSearchProviderDriver } from './providers/factory'
import { createWebSearchProvider } from './providers/factory'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'
import { getProviderForCapability, getRuntimeConfig } from './utils/config'
import { normalizeWebSearchKeywords, normalizeWebSearchUrls } from './utils/input'
import { ApiKeyRotationState } from './utils/provider'
import { WebSearchConfigError } from './WebSearchConfigError'

const logger = loggerService.withContext('MainWebSearchService')

type RunCapabilityRequest = {
  providerId?: WebSearchProvider['id']
  capability: WebSearchCapability
  inputs: string[]
}

type PostProcessingMode = 'configured' | 'none'

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
      throw new WebSearchConfigError(
        'capability_unsupported',
        `Web search provider ${context.provider.id} does not implement capability ${context.capability}`
      )
    }

    return Promise.allSettled(
      context.inputs.map((input) =>
        capabilityRunner.call(context.providerDriver, input, context.runtimeConfig, httpOptions)
      )
    )
  }

  private async executeFetchUrlsWithFallback(
    context: PreparedWebSearchContext,
    httpOptions?: RequestInit
  ): Promise<PromiseSettledResult<WebSearchResponse>[]> {
    const signal = httpOptions?.signal ?? undefined
    signal?.throwIfAborted()
    const primaryResults = await this.executeCapability(context, httpOptions)
    signal?.throwIfAborted()

    if (context.provider.id !== 'fetch' && context.provider.id !== 'jina') {
      return primaryResults
    }

    const failedIndexes = primaryResults.flatMap((result, index) => (result.status === 'rejected' ? [index] : []))
    if (failedIndexes.length === 0) {
      return primaryResults
    }

    const fallbackProviderId = context.provider.id === 'fetch' ? 'jina' : 'fetch'
    const fallbackCandidates = failedIndexes.flatMap((index) => {
      const input = context.inputs[index]

      if (context.provider.id !== 'fetch') {
        return [{ index, input }]
      }

      try {
        return [{ index, input: sanitizeRemoteUrl(input) }]
      } catch {
        return []
      }
    })

    if (fallbackCandidates.length === 0) {
      return primaryResults
    }

    const fallbackProvider = await getProviderForCapability(
      fallbackProviderId,
      'fetchUrls',
      application.get('PreferenceService')
    )
    signal?.throwIfAborted()
    const fallbackContext: PreparedWebSearchContext = {
      ...context,
      inputs: fallbackCandidates.map(({ input }) => input),
      provider: fallbackProvider,
      providerDriver: createWebSearchProvider(fallbackProvider, this.apiKeyRotationState)
    }
    const fallbackResults = await this.executeCapability(fallbackContext, httpOptions)
    signal?.throwIfAborted()
    const mergedResults = [...primaryResults]
    let recoveredInputs = 0

    fallbackResults.forEach((result, fallbackIndex) => {
      const candidate = fallbackCandidates[fallbackIndex]
      const primaryResult = primaryResults[candidate.index] as PromiseRejectedResult

      if (result.status === 'fulfilled') {
        recoveredInputs += 1
        mergedResults[candidate.index] = {
          status: 'fulfilled',
          value: {
            ...result.value,
            query: context.inputs[candidate.index],
            inputs: [context.inputs[candidate.index]],
            results: result.value.results.map((item) => ({ ...item, sourceInput: context.inputs[candidate.index] }))
          }
        }
        return
      }

      mergedResults[candidate.index] = {
        status: 'rejected',
        reason: new AggregateError([primaryResult.reason, result.reason], 'Web fetch failed after fallback', {
          cause: primaryResult.reason
        })
      }
    })

    if (recoveredInputs > 0) {
      logger.info('Web fetch fallback recovered failed inputs', {
        primaryProviderId: context.provider.id,
        fallbackProviderId,
        recoveredInputs
      })
    }

    if (mergedResults.every((result) => result.status === 'rejected')) {
      const errors = mergedResults.flatMap((result) =>
        result.reason instanceof AggregateError ? result.reason.errors : [result.reason]
      )
      throw new AggregateError(errors, 'Web fetch failed after fallback', { cause: errors[0] })
    }

    return mergedResults
  }

  private async buildFinalResponse(
    context: PreparedWebSearchContext,
    searchResults: PromiseSettledResult<WebSearchResponse>[],
    httpOptions: RequestInit | undefined,
    postProcessingMode: PostProcessingMode
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

    if (postProcessingMode === 'none') {
      return mergedResponse
    }

    const filteredResponse = filterWebSearchResponseWithBlacklist(mergedResponse, context.runtimeConfig.excludeDomains)
    const postProcessed = await postProcessWebSearchResponse(filteredResponse, context.runtimeConfig)

    return postProcessed.response
  }

  @TraceMethod({ spanName: 'WebSearch', tag: 'WebSearch' })
  private async runCapability(
    request: RunCapabilityRequest,
    httpOptions?: RequestInit,
    postProcessingMode: PostProcessingMode = 'configured'
  ): Promise<WebSearchResponse> {
    let context: PreparedWebSearchContext | undefined

    try {
      context = await this.prepareContext(request)
      const searchResults =
        context.capability === 'fetchUrls'
          ? await this.executeFetchUrlsWithFallback(context, httpOptions)
          : await this.executeCapability(context, httpOptions)
      return await this.buildFinalResponse(context, searchResults, httpOptions, postProcessingMode)
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

  /** Fetch provider-normalized content without Agent-facing blacklist or compression processing. */
  async fetchUrlsUnprocessed(
    request: WebSearchFetchUrlsRequest,
    httpOptions?: RequestInit
  ): Promise<WebSearchResponse> {
    return this.runCapability(
      {
        providerId: request.providerId,
        capability: 'fetchUrls',
        inputs: normalizeWebSearchUrls(request.urls)
      },
      httpOptions,
      'none'
    )
  }
}
