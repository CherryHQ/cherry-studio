import type {
  WebSearchCapability,
  WebSearchCompressionMethod,
  WebSearchProvider,
  WebSearchProviderId,
  WebSearchProviderOverrides
} from '@shared/data/preference/preferenceTypes'

/**
 * Runtime-shaped provider: preset metadata merged with the user's
 * `WebSearchProviderOverride`. `WebSearchProvider` already encodes this
 * shape — alias is kept so callers can read intent at the call site.
 */
export type ResolvedWebSearchProvider = WebSearchProvider

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

export type WebSearchCheckProviderRequest = {
  /** Full provider override (including a tentative apiKey/apiHost) — bypasses preferences. */
  provider: ResolvedWebSearchProvider
  /** Capability to exercise. Defaults to 'searchKeywords'. */
  capability?: WebSearchCapability
}

export type WebSearchCheckProviderResponse = {
  valid: boolean
  error?: string
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

export type WebSearchResolvedConfig = {
  providers: WebSearchProvider[]
  runtime: WebSearchExecutionConfig
  providerOverrides: WebSearchProviderOverrides
}
