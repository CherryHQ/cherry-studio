import type OpenAI from '@cherrystudio/openai'
import type { GroundingMetadata } from '@google/genai'
import type { McpServer } from '@shared/data/types/mcpServer'

import type { FileMetadata } from './file'
import type { GenerateImageResponse } from './image'
import type { KnowledgeReference } from './knowledge'
import type { McpToolResponse } from './mcpTool'
import type { Model } from './model'
import type { WebSearchProviderResponse } from './webSearchProvider'

export type Usage = OpenAI.Completions.CompletionUsage & {
  thoughts_tokens?: number
  no_cache_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  // OpenRouter specific fields
  cost?: number
}

export type Metrics = {
  completion_tokens: number
  time_completion_millsec: number
  time_first_token_millsec?: number
  time_thinking_millsec?: number
}

export type LegacyMessage = {
  id: string
  assistantId: string
  role: 'user' | 'assistant'
  content: string
  reasoning_content?: string
  translatedContent?: string
  topicId: string
  createdAt: string
  status: 'sending' | 'pending' | 'searching' | 'success' | 'paused' | 'error'
  modelId?: string
  model?: Model
  files?: FileMetadata[]
  images?: string[]
  usage?: Usage
  metrics?: Metrics
  knowledgeBaseIds?: string[]
  type: 'text' | '@' | 'clear'
  mentions?: Model[]
  askId?: string
  useful?: boolean
  error?: Record<string, any>
  enabledMCPs?: McpServer[]
  metadata?: {
    // Gemini
    groundingMetadata?: GroundingMetadata
    // Perplexity Or Openrouter
    citations?: string[]
    // OpenAI
    annotations?: OpenAI.Chat.Completions.ChatCompletionMessage.Annotation[]
    // Zhipu or Hunyuan
    webSearchInfo?: any[]
    // Web search
    webSearch?: WebSearchProviderResponse
    // MCP Tools
    mcpTools?: McpToolResponse[]
    // Generate Image
    generateImage?: GenerateImageResponse
    // knowledge
    knowledge?: KnowledgeReference[]
  }
  // multi-model message style
  multiModelMessageStyle?: 'horizontal' | 'vertical' | 'fold' | 'grid'
  // whether selected when folded
  foldSelected?: boolean
}

export interface Citation {
  number: number
  url: string
  title?: string
  hostname?: string
  content?: string
  showFavicon?: boolean
  type?: string
  metadata?: Record<string, any>
}
