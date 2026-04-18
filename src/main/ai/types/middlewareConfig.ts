import type { WebSearchPluginConfig } from '@cherrystudio/ai-core/built-in/plugins'
import type { Assistant, MCPTool, Message } from '@types'

/**
 * AI SDK middleware config for plugin building.
 *
 * Note: provider and model are NOT in this interface.
 * They are intrinsic properties of the AI execution context,
 * injected internally by AiService.
 *
 * Migrated from renderer — removed `onChunk` callback (replaced by ReadableStream<UIMessageChunk>).
 */
export interface AiSdkMiddlewareConfig {
  streamOutput: boolean
  assistant?: Assistant
  enableReasoning: boolean
  isPromptToolUse: boolean
  isSupportedToolUse: boolean
  enableWebSearch: boolean
  enableGenerateImage: boolean
  enableUrlContext: boolean
  mcpTools?: MCPTool[]
  uiMessages?: Message[]
  webSearchPluginConfig?: WebSearchPluginConfig
  urlContextConfig?: Record<string, any>
  knowledgeRecognition?: 'off' | 'on'
  mcpMode?: string
}
