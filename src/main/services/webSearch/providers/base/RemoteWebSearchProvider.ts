import {
  createWebSearchClient,
  isWebSearchError,
  type WebSearchClient,
  type WebSearchCredentials,
  type WebSearchProviderModule,
  type WebSearchResultSet
} from '@cherrystudio/web-search'
import type { WebSearchCapability, WebSearchProvider } from '@shared/data/preference/preferenceTypes'
import type { WebSearchExecutionConfig, WebSearchResponse } from '@shared/data/types/webSearch'

import { electronWebSearchTransport } from '../../transport'
import type { ApiKeyRotationState } from '../../utils/provider'
import { resolveProviderApiHost } from '../../utils/provider'
import { WebSearchConfigError, type WebSearchConfigErrorCode } from '../../WebSearchConfigError'
import { BaseWebSearchProvider } from './BaseWebSearchProvider'

export class RemoteWebSearchProvider extends BaseWebSearchProvider {
  private readonly client: WebSearchClient

  constructor(
    provider: WebSearchProvider,
    state: ApiKeyRotationState,
    private readonly protocol: WebSearchProviderModule
  ) {
    super(provider, state)
    this.client = createWebSearchClient({
      transport: electronWebSearchTransport,
      providers: [
        {
          provider: protocol,
          capabilities: protocol.metadata.capabilities
            .filter((capability) => provider.capabilities.some((item) => item.feature === capability.capability))
            .map((item) => item.capability)
        }
      ]
    })
  }

  protected credentials(): WebSearchCredentials {
    return {
      apiKey: this.protocol.metadata.capabilities.some((item) => item.apiKey !== 'unused')
        ? this.resolveApiKey(false)
        : undefined,
      basicAuth: {
        username: this.provider.basicAuthUsername.trim(),
        password: this.provider.basicAuthPassword.trim()
      }
    }
  }

  protected async executeRemote(
    capability: WebSearchCapability,
    input: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit,
    overrides: {
      apiHost?: string
      credentials?: WebSearchCredentials
      engines?: readonly string[]
      timeoutMs?: number
    } = {}
  ): Promise<WebSearchResponse> {
    if (capability === 'fetchUrls') input = input.trim()
    const apiHost = overrides.apiHost ?? resolveProviderApiHost(this.provider, capability)
    const common = {
      providerId: this.protocol.metadata.id,
      input,
      credentials: overrides.credentials ?? this.credentials(),
      signal: httpOptions?.signal ?? undefined,
      timeoutMs: overrides.timeoutMs
    }
    let response: WebSearchResultSet
    try {
      response = await this.client.execute(
        capability === 'searchKeywords'
          ? {
              ...common,
              capability,
              config: {
                apiHost,
                maxResults: config.maxResults,
                ...(this.provider.id === 'searxng' ? { engines: overrides.engines ?? this.provider.engines } : {}),
                ...(['bocha', 'querit'].includes(this.provider.id) ? { excludeDomains: config.excludeDomains } : {})
              }
            }
          : { ...common, capability, config: { apiHost } }
      )
    } catch (error) {
      if (isWebSearchError(error) && error.kind === 'configuration') {
        const code: WebSearchConfigErrorCode = ['api_key_missing', 'api_host_missing', 'api_host_invalid'].includes(
          error.code
        )
          ? (error.code as WebSearchConfigErrorCode)
          : 'capability_unsupported'
        throw new WebSearchConfigError(code, error.message, { cause: error })
      }
      throw error
    }
    return {
      query: input,
      providerId: this.provider.id,
      capability,
      inputs: [input],
      results: response.results.map((item) => ({ ...item }))
    }
  }
}
