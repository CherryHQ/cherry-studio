import { application } from '@application'
import { loggerService } from '@logger'
import { TraceMethod } from '@main/ai/observability'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { isAbortError } from '@main/utils/error'
import { sanitizeRemoteUrl } from '@main/utils/remoteUrlSafety'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type {
  WebSearchExecutionConfig,
  WebSearchFetchUrlsRequest,
  WebSearchResponse,
  WebSearchSearchKeywordsRequest
} from '@shared/data/types/webSearch'
import { getWebSearchFallbackProviderIds, getWebSearchProviderReadiness } from '@shared/utils/webSearch'

import { postProcessWebSearchResponse } from './postProcessing'
import type { WebSearchProviderDriver } from './providers/factory'
import { createWebSearchProvider } from './providers/factory'
import { filterWebSearchResponseWithBlacklist } from './utils/blacklist'
import { getProviderForCapability, getRuntimeConfig, isPermanentWebSearchConfigError } from './utils/config'
import { normalizeWebSearchKeywords, normalizeWebSearchUrls } from './utils/input'
import { ApiKeyRotationState } from './utils/provider'
import { WebSearchConfigError } from './WebSearchConfigError'

const logger = loggerService.withContext('MainWebSearchService')

function createWebSearchAggregateError(errors: unknown[], message: string): AggregateError {
  const details = errors.map((error) => (error instanceof Error ? error.message : String(error))).join('; ')
  return new AggregateError(errors, `${message}: ${details}`, { cause: errors[0] })
}

type RunCapabilityRequest = {
  providerId?: WebSearchProvider['id']
  capability: WebSearchCapability
  inputs: string[]
}

type PostProcessingMode = 'configured' | 'none'

type WebSearchExecutionOptions = {
  fallback?: boolean
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

  private getProviderConfigurationError(context: PreparedWebSearchContext): WebSearchConfigError | undefined {
    const readiness = getWebSearchProviderReadiness(context.provider, context.capability)
    if (readiness.ready) return undefined

    const messages = {
      provider_not_configured: `Web search provider is not configured for capability ${context.capability}`,
      capability_unsupported: `Web search provider ${context.provider.id} does not support capability ${context.capability}`,
      api_key_missing: `API key is required for provider ${context.provider.id}`,
      api_host_missing: `API host is required for provider ${context.provider.id}`,
      api_host_invalid: `API host must be a valid HTTP(S) URL for provider ${context.provider.id}`
    } as const

    return new WebSearchConfigError(readiness.reason, messages[readiness.reason])
  }

  private async executeCapabilityWithFallback(
    context: PreparedWebSearchContext,
    httpOptions?: RequestInit,
    options: WebSearchExecutionOptions = {}
  ): Promise<PromiseSettledResult<WebSearchResponse>[]> {
    const signal = httpOptions?.signal ?? undefined
    signal?.throwIfAborted()
    const configurationError = this.getProviderConfigurationError(context)
    if (configurationError && options.fallback === false) {
      throw configurationError
    }

    const primaryResults: PromiseSettledResult<WebSearchResponse>[] = configurationError
      ? context.inputs.map(() => ({ status: 'rejected', reason: configurationError }))
      : await this.executeCapability(context, httpOptions)
    signal?.throwIfAborted()

    if (options.fallback === false) {
      return primaryResults
    }

    const mergedResults = [...primaryResults]
    const errorsByInput = primaryResults.map((result) => (result.status === 'rejected' ? [result.reason] : []))
    const failureMessage =
      context.capability === 'fetchUrls' ? 'Web fetch failed after fallback' : 'Web search failed after fallback'
    let attemptedFallback = false

    for (const fallbackProviderId of getWebSearchFallbackProviderIds(context.provider.id, context.capability)) {
      const failedIndexes = mergedResults.flatMap((result, index) => (result.status === 'rejected' ? [index] : []))
      if (failedIndexes.length === 0) break

      const allowPrivateNetwork = application.get('PreferenceService').get('app.fetch.allow_private_network')
      const fallbackCandidates = failedIndexes.flatMap((index) => {
        const input = context.inputs[index]

        if (context.capability !== 'fetchUrls' || fallbackProviderId !== 'jina') {
          return [{ index, input }]
        }

        try {
          return [{ index, input: sanitizeRemoteUrl(input, undefined, allowPrivateNetwork) }]
        } catch {
          return []
        }
      })

      if (fallbackCandidates.length === 0) continue

      const fallbackProvider = await getProviderForCapability(
        fallbackProviderId,
        context.capability,
        application.get('PreferenceService')
      )
      signal?.throwIfAborted()
      const fallbackContext: PreparedWebSearchContext = {
        ...context,
        inputs: fallbackCandidates.map(({ input }) => input),
        provider: fallbackProvider,
        providerDriver: createWebSearchProvider(fallbackProvider, this.apiKeyRotationState)
      }
      const fallbackConfigurationError = this.getProviderConfigurationError(fallbackContext)
      const fallbackResults: PromiseSettledResult<WebSearchResponse>[] = fallbackConfigurationError
        ? fallbackContext.inputs.map(() => ({ status: 'rejected', reason: fallbackConfigurationError }))
        : await this.executeCapability(fallbackContext, httpOptions)
      attemptedFallback = true
      signal?.throwIfAborted()
      let recoveredInputs = 0

      fallbackResults.forEach((result, fallbackIndex) => {
        const candidate = fallbackCandidates[fallbackIndex]

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

        errorsByInput[candidate.index].push(result.reason)
        mergedResults[candidate.index] = {
          status: 'rejected',
          reason: createWebSearchAggregateError(errorsByInput[candidate.index], failureMessage)
        }
      })

      if (recoveredInputs > 0) {
        logger.info(
          context.capability === 'fetchUrls'
            ? 'Web fetch fallback recovered failed inputs'
            : 'Web search fallback recovered failed inputs',
          {
            primaryProviderId: context.provider.id,
            fallbackProviderId,
            recoveredInputs
          }
        )
      }
    }

    if (attemptedFallback && mergedResults.every((result) => result.status === 'rejected')) {
      const errors = mergedResults.flatMap((result) =>
        result.reason instanceof AggregateError ? result.reason.errors : [result.reason]
      )
      const configurationError = errors.find(isPermanentWebSearchConfigError)
      if (configurationError && errors.every(isPermanentWebSearchConfigError)) {
        throw configurationError
      }
      throw createWebSearchAggregateError(errors, failureMessage)
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

    const successfulProviderIds = new Set(successfulSearches.map((item) => item.value.providerId))
    const providerIds = [
      context.provider.id,
      ...getWebSearchFallbackProviderIds(context.provider.id, context.capability)
    ].filter((providerId) => successfulProviderIds.has(providerId))
    const providerId = providerIds.at(-1) ?? context.provider.id

    const mergedResponse: WebSearchResponse = {
      query: context.inputs.join(' | '),
      providerId,
      ...(providerIds.length > 1 ? { providerIds } : {}),
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
    postProcessingMode: PostProcessingMode = 'configured',
    executionOptions: WebSearchExecutionOptions = {}
  ): Promise<WebSearchResponse> {
    let context: PreparedWebSearchContext | undefined

    try {
      context = await this.prepareContext(request)
      const searchResults = await this.executeCapabilityWithFallback(context, httpOptions, executionOptions)
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

  async searchKeywords(
    request: WebSearchSearchKeywordsRequest,
    httpOptions?: RequestInit,
    executionOptions?: WebSearchExecutionOptions
  ): Promise<WebSearchResponse> {
    return this.runCapability(
      {
        providerId: request.providerId,
        capability: 'searchKeywords',
        inputs: normalizeWebSearchKeywords(request.keywords)
      },
      httpOptions,
      'configured',
      executionOptions
    )
  }

  async fetchUrls(
    request: WebSearchFetchUrlsRequest,
    httpOptions?: RequestInit,
    executionOptions?: WebSearchExecutionOptions
  ): Promise<WebSearchResponse> {
    return this.runCapability(
      {
        providerId: request.providerId,
        capability: 'fetchUrls',
        inputs: normalizeWebSearchUrls(request.urls)
      },
      httpOptions,
      'configured',
      executionOptions
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
