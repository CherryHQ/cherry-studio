/**
 * Common types for provider parsers
 */

/**
 * Entry returned by provider parsers
 * This is the intermediate format used by generate-provider-models.ts
 */
export interface ProviderModelEntry {
  originalId: string // The original API model ID
  normalizedId: string // Normalized ID to match models.json (base model family)
  variant: string | null // Variant suffix like 'free', 'thinking', etc.
  parameterSize: string | null // Parameter size like '72b', '7b', '1.5b'
  name?: string
  ownedBy?: string
  pricing?: {
    input: number
    output: number
    cacheRead?: number
    cacheWrite?: number
    currency?: 'USD' | 'CNY' // Default: USD
  }
  contextWindow?: number
  maxOutputTokens?: number
  hasReasoning?: boolean
  modelType?: string // Model type: 'chat', 'embedding', 'reranker', etc.
  capabilities?: Record<string, boolean> // Provider-specific capabilities
  endpointTypes?: string[] // Endpoint types extracted from provider API
  inputModalities?: string[] // Input modalities extracted from provider API
  outputModalities?: string[] // Output modalities extracted from provider API
}

/**
 * Parser function type
 */
export type ParserFn = (data: unknown) => ProviderModelEntry[]

/**
 * Custom fetch options for providers that need special handling
 */
export interface ProviderFetchOptions {
  headers?: Record<string, string>
  queryParams?: Record<string, string>
}
