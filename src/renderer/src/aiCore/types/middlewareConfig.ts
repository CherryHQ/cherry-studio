import type { WebSearchPluginConfig } from '@cherrystudio/ai-core/built-in/plugins'
import type { MCPTool } from '@renderer/types'
import type { Assistant, Message, Model, Provider } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'

/**
 * AI SDK 中间件配置项（用于插件构建）
 */
export interface AiSdkMiddlewareConfig {
  streamOutput: boolean
  onChunk?: (chunk: Chunk) => void
  model?: Model
  provider?: Provider
  assistant?: Assistant
  enableReasoning: boolean
  isPromptToolUse: boolean
  isSupportedToolUse: boolean
  isImageGenerationEndpoint: boolean
  enableWebSearch: boolean
  enableGenerateImage: boolean
  enableUrlContext: boolean
  mcpTools?: MCPTool[]
  uiMessages?: Message[]
  webSearchPluginConfig?: WebSearchPluginConfig
  knowledgeRecognition?: 'off' | 'on'
  mcpMode?: string
}
