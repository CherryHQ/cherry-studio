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

export type WebSearchRequest = {
  providerId: WebSearchProviderId
  questions: string[]
  requestId: string
}

export type WebSearchPhase =
  | 'default'
  | 'fetch_complete'
  | 'partial_failure'
  | 'rag'
  | 'rag_complete'
  | 'rag_failed'
  | 'cutoff'

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
  maxResults: number
  excludeDomains: string[]
  compression: WebSearchCompressionConfig
}

export type ResolvedWebSearchProvider = {
  id: WebSearchProviderId
  name: string
  type: WebSearchProviderType
  usingBrowser: boolean
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
