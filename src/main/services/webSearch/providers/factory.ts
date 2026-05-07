import type {
  ResolvedWebSearchProvider,
  WebSearchExecutionConfig,
  WebSearchResponse
} from '@shared/data/types/webSearch'

import type { ApiKeyRotationState } from '../utils/provider'
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

export function createWebSearchProvider(
  provider: ResolvedWebSearchProvider,
  apiKeyRotationState?: ApiKeyRotationState
): WebSearchProviderDriver {
  const Provider = WEB_SEARCH_PROVIDER_REGISTRY[provider.id]
  return new Provider(provider, apiKeyRotationState)
}
