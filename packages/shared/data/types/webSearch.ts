import type {
  KeywordSearchProviderId,
  UrlSearchProviderId,
  WebSearchCompressionCutoffUnit,
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
}

export type WebSearchResponse = {
  query?: string
  results: WebSearchResult[]
}

export type WebSearchKeywordRequest = {
  providerId: KeywordSearchProviderId
  questions: string[]
  requestId: string
}

export type WebSearchUrlRequest = {
  providerId: UrlSearchProviderId
  urls: string[]
  requestId: string
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
  cutoffUnit: WebSearchCompressionCutoffUnit
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
  apiHost: string
  engines: string[]
  basicAuthUsername: string
  basicAuthPassword: string
}

export type WebSearchResolvedConfig = {
  providers: ResolvedWebSearchProvider[]
  runtime: WebSearchExecutionConfig
  providerOverrides: WebSearchProviderOverrides
}
