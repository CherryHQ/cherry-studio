import type { LanguageModelV3Source } from '@ai-sdk/provider'
import type { WebSearchResultBlock } from '@anthropic-ai/sdk/resources'
import type OpenAI from '@cherrystudio/openai'
import type { GroundingMetadata } from '@google/genai'
import { objectValues } from '@renderer/utils/object'
import * as z from 'zod'

export const WebSearchProviderIds = {
  zhipu: 'zhipu',
  tavily: 'tavily',
  searxng: 'searxng',
  exa: 'exa',
  'exa-mcp': 'exa-mcp',
  bocha: 'bocha',
  querit: 'querit',
  fetch: 'fetch',
  jina: 'jina',
  firecrawl: 'firecrawl'
} as const

export type WebSearchProviderId = keyof typeof WebSearchProviderIds

export type WebSearchProvider = {
  id: WebSearchProviderId
  name: string
  apiKey?: string
  apiHost?: string
  engines?: string[]
  url?: string
  basicAuthUsername?: string
  basicAuthPassword?: string
  topicId?: string
  allowedTools?: string[]
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

export type AiSdkWebSearchResult = Omit<Extract<LanguageModelV3Source, { sourceType: 'url' }>, 'sourceType'>

export type WebSearchResults =
  | WebSearchProviderResponse
  | GroundingMetadata
  | OpenAI.Chat.Completions.ChatCompletionMessage.Annotation.URLCitation[]
  | OpenAI.Responses.ResponseOutputText.URLCitation[]
  | WebSearchResultBlock[]
  | AiSdkWebSearchResult[]
  | any[]

export const WEB_SEARCH_SOURCE = {
  WEBSEARCH: 'websearch',
  OPENAI: 'openai',
  OPENAI_RESPONSE: 'openai-response',
  OPENROUTER: 'openrouter',
  ANTHROPIC: 'anthropic',
  GEMINI: 'gemini',
  PERPLEXITY: 'perplexity',
  QWEN: 'qwen',
  HUNYUAN: 'hunyuan',
  ZHIPU: 'zhipu',
  GROK: 'grok',
  AISDK: 'ai-sdk'
} as const

export const WebSearchSourceSchema = z.enum(objectValues(WEB_SEARCH_SOURCE))

export type WebSearchSource = z.infer<typeof WebSearchSourceSchema>

export type WebSearchResponse = {
  results?: WebSearchResults
  source: WebSearchSource
}
