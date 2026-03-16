import type { WebSearchPluginConfig } from '@cherrystudio/ai-core/built-in/plugins'
import type { MCPTool } from '@renderer/types'
import type { Assistant, Message } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'

/**
 * AI SDK 中间件配置项（用于插件构建）
 *
 * 注意：provider 和 model 不在此接口中。
 * 它们是 ModernAiProvider 的固有属性（构造时确定），
 * 由 ModernAiProvider 内部注入到 buildPlugins，避免调用方遗漏。
 */
export interface AiSdkMiddlewareConfig {
  streamOutput: boolean
  onChunk?: (chunk: Chunk) => void
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
