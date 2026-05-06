import type { WebSearchCapability } from '@shared/data/preference/preferenceTypes'
import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'

import type { BaseWebSearchProvider } from './base/BaseWebSearchProvider'
import { WEB_SEARCH_PROVIDER_REGISTRY } from './registry'

export type WebSearchProviderDriver = BaseWebSearchProvider & {
  searchKeywords?: (
    input: string,
    config: WebSearchExecutionConfig,
    httpOptions?: RequestInit
  ) => Promise<WebSearchResponse>
  fetchUrls?: (input: string, config: WebSearchExecutionConfig, httpOptions?: RequestInit) => Promise<WebSearchResponse>
}

export function webSearchProviderSupportsCapability(
  provider: ResolvedWebSearchProvider,
  capability: WebSearchCapability
): boolean {
  return provider.capabilities.some((item) => item.feature === capability)
}

export function assertWebSearchProviderSupportsCapability(
  provider: ResolvedWebSearchProvider,
  capability: WebSearchCapability
): void {
  if (!webSearchProviderSupportsCapability(provider, capability)) {
    throw new Error(`Web search provider ${provider.id} does not support capability ${capability}`)
  }
}

export function createWebSearchProvider(provider: ResolvedWebSearchProvider): WebSearchProviderDriver {
  const Provider = WEB_SEARCH_PROVIDER_REGISTRY[provider.id]
  return new Provider(provider)
}
