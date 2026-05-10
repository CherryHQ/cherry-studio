import type {
  WebSearchCapability,
  WebSearchCompressionMethod,
  WebSearchProviderId,
  WebSearchProviderOverrides,
  WebSearchProviderType
} from '@shared/data/preference/preferenceTypes'

export const DEFAULT_WEB_SEARCH_CUTOFF_LIMIT = 2000

export function normalizeWebSearchCutoffLimit(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_WEB_SEARCH_CUTOFF_LIMIT
}

export type WebSearchResult = {
  title: string
  content: string
  url: string
  sourceInput: string
}

export type WebSearchResponse = {
  query?: string
  providerId: WebSearchProviderId
  capability: WebSearchCapability
  inputs: string[]
  results: WebSearchResult[]
}

export type WebSearchSearchKeywordsRequest = {
  providerId?: WebSearchProviderId
  keywords: string[]
}

export type WebSearchFetchUrlsRequest = {
  providerId?: WebSearchProviderId
  urls: string[]
}

export type WebSearchPhase = 'default' | 'fetch_complete' | 'partial_failure' | 'cutoff'

export type WebSearchStatus = {
  phase: WebSearchPhase
  countBefore?: number
  countAfter?: number
}

export type WebSearchCompressionConfig = {
  method: WebSearchCompressionMethod
  cutoffLimit: number
}

export type WebSearchExecutionConfig = {
  maxResults: number
  excludeDomains: string[]
  compression: WebSearchCompressionConfig
}

export type ResolvedWebSearchProvider = {
  id: WebSearchProviderId
  name: string
  type: WebSearchProviderType
  apiKeys: string[]
  capabilities: Array<{
    feature: WebSearchCapability
    apiHost?: string
  }>
  engines: string[]
  basicAuthUsername: string
  basicAuthPassword: string
}

export type WebSearchResolvedConfig = {
  providers: ResolvedWebSearchProvider[]
  runtime: WebSearchExecutionConfig
  providerOverrides: WebSearchProviderOverrides
}
