import type { LanguageModelV2Source } from '@ai-sdk/provider'
import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import { GroundingMetadata } from '@google/genai'
import OpenAI from 'openai'

export const WebSearchProviderIds = {
  zhipu: 'zhipu',
  tavily: 'tavily',
  searxng: 'searxng',
  exa: 'exa',
  bocha: 'bocha',
  'local-google': 'local-google',
  'local-bing': 'local-bing',
  'local-baidu': 'local-baidu'
} as const

export type WebSearchProviderId = keyof typeof WebSearchProviderIds

export const isWebSearchProviderId = (id: string): id is WebSearchProviderId => {
  return Object.hasOwn(WebSearchProviderIds, id)
}

export type WebSearchProvider = {
  id: WebSearchProviderId
  name: string
  apiKey?: string
  apiHost?: string
  engines?: string[]
  url?: string
  basicAuthUsername?: string
  basicAuthPassword?: string
  usingBrowser?: boolean
  topicId?: string
  parentSpanId?: string
  modelName?: string
}

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
