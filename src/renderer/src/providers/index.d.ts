import type { GroundingMetadata } from '@google/generative-ai'
import type { Assistant, MCPToolResponse, Message, Metrics } from '@renderer/types'

interface ChunkCallbackData {
  text?: string
  reasoning_content?: string
  usage?: OpenAI.Completions.CompletionUsage
  metrics?: Metrics
  // Zhipu web search
  webSearch?: any[]
  // Gemini web search
  search?: GroundingMetadata
  // Openai web search
  annotations?: OpenAI.Chat.Completions.ChatCompletionMessage.Annotation[]
  // Openrouter web search or Knowledge base
  citations?: string[]
  mcpToolResponse?: MCPToolResponse[]
  generateImage?: GenerateImageResponse
}

interface CompletionsParams {
  messages: Message[]
  assistant: Assistant
  onChunk: ({
    text,
    reasoning_content,
    usage,
    metrics,
    webSearch,
    search,
    annotations,
    citations,
    mcpToolResponse,
    generateImage
  }: ChunkCallbackData) => void
  onFilterMessages: (messages: Message[]) => void
  mcpTools?: MCPTool[]
}
