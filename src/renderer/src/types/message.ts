import type { GroundingMetadata } from '@google/genai'
import type OpenAI from 'openai'

import type { FileMetadata } from './file'
import { KnowledgeReference } from './knowledge'
import { MCPServer, MCPToolResponse } from './mcp'
import { Model } from './model'
import { GenerateImageResponse, Metrics, Usage } from './newMessage'
import { WebSearchProviderResponse } from './websearch'

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
  enabledMCPs?: MCPServer[]
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
    mcpTools?: MCPToolResponse[]
    // Generate Image
    generateImage?: GenerateImageResponse
    // knowledge
    knowledge?: KnowledgeReference[]
  }
  // 多模型消息样式
  multiModelMessageStyle?: 'horizontal' | 'vertical' | 'fold' | 'grid'
  // fold时是否选中
  foldSelected?: boolean
}
