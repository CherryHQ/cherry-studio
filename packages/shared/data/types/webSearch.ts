import type {
  WebSearchCompressionCutoffUnit,
  WebSearchCompressionMethod,
  WebSearchProviderId,
  WebSearchProviderOverrides,
  WebSearchProviderType
} from '@shared/data/preference/preferenceTypes'

export type WebSearchResult = {
  title: string
  content: string
  url: string
}

export type WebSearchResponse = {
  query?: string
  results: WebSearchResult[]
}

export type WebSearchQueryInput = {
  question: string[]
}

export type WebSearchRequest = {
  providerId: WebSearchProviderId
  input: WebSearchQueryInput
  requestId: string
}

export type WebSearchPhase = 'default' | 'fetch_complete' | 'rag' | 'rag_complete' | 'rag_failed' | 'cutoff'

export type WebSearchStatus = {
  phase: WebSearchPhase
  countBefore?: number
  countAfter?: number
}

export type WebSearchCompressionConfig = {
  method: WebSearchCompressionMethod
  cutoffLimit: number | null
  cutoffUnit: WebSearchCompressionCutoffUnit
  ragDocumentCount: number
  ragEmbeddingModelId: string | null
  ragEmbeddingDimensions: number | null
  ragRerankModelId: string | null
}

export type WebSearchExecutionConfig = {
  searchWithTime: boolean
  maxResults: number
  excludeDomains: string[]
  compression: WebSearchCompressionConfig
}

export type ResolvedWebSearchProvider = {
  id: WebSearchProviderId
  name: string
  type: WebSearchProviderType
  usingBrowser: boolean
  apiKey: string
  apiHost: string
  engines: string[]
  basicAuthUsername: string
  basicAuthPassword: string
}

export type SupportedWebSearchProviderType = WebSearchProviderType

export type WebSearchResolvedConfig = {
  providers: ResolvedWebSearchProvider[]
  runtime: WebSearchExecutionConfig
  providerOverrides: WebSearchProviderOverrides
}

export type WebSearchErrorCode =
  | 'provider_not_found'
  | 'unsupported_provider_type'
  | 'invalid_query'
  | 'provider_request_failed'

export type WebSearchError = {
  code: WebSearchErrorCode
  message: string
  cause?: unknown
}
