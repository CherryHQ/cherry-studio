import type { LanguageModelV2Source } from '@ai-sdk/provider'
import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type OpenAI from '@cherrystudio/openai'
import type { GroundingMetadata } from '@google/genai'
import type { WebSearchProvider } from '@shared/data/preference/preferenceTypes'

// =============================================================================
// WebSearchProvider Types
// =============================================================================

/**
 * Re-export the storage type from preferenceTypes
 * Use this for Preference storage and Redux store
 */
export type { WebSearchProvider }

// =============================================================================
// Deprecated - Keep for backward compatibility during migration
// =============================================================================

/**
 * @deprecated Use string type directly. Kept for ApiKeyListPopup compatibility.
 */
export const WebSearchProviderIds = {
  zhipu: 'zhipu',
  tavily: 'tavily',
  searxng: 'searxng',
  exa: 'exa',
  'exa-mcp': 'exa-mcp',
  bocha: 'bocha',
  'local-google': 'local-google',
  'local-bing': 'local-bing',
  'local-baidu': 'local-baidu'
} as const

/**
 * @deprecated Use string type directly. Kept for ApiKeyListPopup compatibility.
 */
export type WebSearchProviderId = keyof typeof WebSearchProviderIds

/**
 * @deprecated Use provider.type field instead. Kept for ApiKeyListPopup compatibility.
 */
export const isWebSearchProviderId = (id: string): id is WebSearchProviderId => {
  return Object.hasOwn(WebSearchProviderIds, id)
}

// =============================================================================
// Search Result Types
// =============================================================================

export type WebSearchProviderResult = {
  title: string
  content: string
  url: string
}

export type WebSearchProviderResponse = {
  query?: string
  results: WebSearchProviderResult[]
}

export type AISDKWebSearchResult = Omit<Extract<LanguageModelV2Source, { sourceType: 'url' }>, 'sourceType'>

export type WebSearchResults =
  | WebSearchProviderResponse
  | GroundingMetadata
  | OpenAI.Chat.Completions.ChatCompletionMessage.Annotation.URLCitation[]
  | OpenAI.Responses.ResponseOutputText.URLCitation[]
  | WebSearchResultBlock[]
  | AISDKWebSearchResult[]
  | any[]

export enum WebSearchSource {
  WEBSEARCH = 'websearch',
  OPENAI = 'openai',
  OPENAI_RESPONSE = 'openai-response',
  OPENROUTER = 'openrouter',
  ANTHROPIC = 'anthropic',
  GEMINI = 'gemini',
  PERPLEXITY = 'perplexity',
  QWEN = 'qwen',
  HUNYUAN = 'hunyuan',
  ZHIPU = 'zhipu',
  GROK = 'grok',
  AISDK = 'ai-sdk'
}

export type WebSearchResponse = {
  results?: WebSearchResults
  source: WebSearchSource
}

export type WebSearchPhase = 'default' | 'fetch_complete' | 'rag' | 'rag_complete' | 'rag_failed' | 'cutoff'

export type WebSearchStatus = {
  phase: WebSearchPhase
  countBefore?: number
  countAfter?: number
}

export interface WebSearchConfig {
  maxResults: number
  excludeDomains: string[]
  searchWithTime: boolean
}
