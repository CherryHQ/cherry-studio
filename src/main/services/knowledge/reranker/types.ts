/**
 * Types and interfaces for the reranker module
 */

/**
 * Known reranker provider identifiers
 */
export const RERANKER_PROVIDERS = {
  VOYAGEAI: 'voyageai',
  BAILIAN: 'bailian',
  JINA: 'jina',
  TEI: 'tei',
  DEFAULT: 'default'
} as const

export type RerankProviderId = (typeof RERANKER_PROVIDERS)[keyof typeof RERANKER_PROVIDERS] | string

/**
 * Check if provider is a TEI provider
 */
export function isTEIProvider(provider?: string): boolean {
  return provider?.includes(RERANKER_PROVIDERS.TEI) ?? false
}

/**
 * Multimodal document for reranking (supports text and image)
 */
export interface MultiModalDocument {
  text?: string
  image?: string
}

/**
 * Result item from reranking API
 */
export interface RerankResultItem {
  index: number
  relevance_score: number
}

/**
 * Core interface for all rerank providers
 * Follows Interface Segregation Principle - only essential methods
 */
export interface RerankProvider {
  /**
   * Provider identifier for registry lookup
   */
  readonly providerId: RerankProviderId

  /**
   * Build the API URL for reranking
   * @param baseURL Base URL from client config
   * @returns Complete URL for rerank API
   */
  buildUrl(baseURL?: string): string

  /**
   * Build request body for rerank API
   * @param query Query string
   * @param documents Documents to rerank
   * @param topN Number of top results to return
   * @param model Model identifier
   * @returns Request body object
   */
  buildRequestBody(query: string, documents: MultiModalDocument[], topN: number, model?: string): unknown

  /**
   * Extract results from API response
   * @param data API response data
   * @returns Array of rerank results
   */
  extractResults(data: unknown): RerankResultItem[]

  /**
   * Optional: Check if this provider handles the given provider ID
   * Enables flexible matching (e.g., "tei-local" matching "tei")
   */
  matches?(providerId: string): boolean
}
