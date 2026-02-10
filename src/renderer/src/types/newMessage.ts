import type { CompletionUsage } from '@cherrystudio/openai/resources'
import type { ProviderMetadata } from 'ai'
import * as z from 'zod'

import {
  type Assistant,
  type FileMetadata,
  type GenerateImageResponse,
  type KnowledgeReference,
  type MCPServer,
  type MCPToolResponse,
  type MemoryItem,
  type Metrics,
  type Model,
  ModelSchema,
  type NormalToolResponse,
  objectValues,
  type Topic,
  type Usage,
  type WebSearchResponse,
  type WebSearchSource
} from '.'
import { SerializedErrorSchema } from './error'

// MessageBlock type enum - optimized based on actual API return characteristics
export const MESSAGE_BLOCK_TYPE = {
  /** Unknown type, used before returning */
  UNKNOWN: 'unknown',
  /** Main text content */
  MAIN_TEXT: 'main_text',
  /** Thinking process (Claude, OpenAI-o series, etc.) */
  THINKING: 'thinking',
  /** Translation */
  TRANSLATION: 'translation',
  /** Image content */
  IMAGE: 'image',
  /** Code block */
  CODE: 'code',
  /** Added unified tool block type */
  TOOL: 'tool',
  /** File content */
  FILE: 'file',
  /** Error information */
  ERROR: 'error',
  /** Citation type (Now includes web search, grounding, etc.) */
  CITATION: 'citation',
  /** Video content */
  VIDEO: 'video',
  /** Compact command response */
  COMPACT: 'compact'
} as const

export const MessageBlockTypeSchema = z.enum(objectValues(MESSAGE_BLOCK_TYPE))

export type MessageBlockType = z.infer<typeof MessageBlockTypeSchema>

// 块状态定义
export const MESSAGE_BLOCK_STATUS = {
  PENDING: 'pending', // 等待处理
  PROCESSING: 'processing', // 正在处理，等待接收
  STREAMING: 'streaming', // 正在流式接收
  SUCCESS: 'success', // 处理成功
  ERROR: 'error', // 处理错误
  PAUSED: 'paused' // 处理暂停
} as const

export const MessageBlockStatusSchema = z.enum(objectValues(MESSAGE_BLOCK_STATUS))

export type MessageBlockStatus = z.infer<typeof MessageBlockStatusSchema>

export const BaseMessageBlockSchemaConfig = {
  /** Block ID */
  id: z.string(),
  /** ID of the message this block belongs to */
  messageId: z.string(),
  /** Type of the block */
  type: MessageBlockTypeSchema,
  /** Creation time */
  createdAt: z.string(),
  /** Last update time */
  updatedAt: z.string().optional(),
  /** Status of the block */
  status: MessageBlockStatusSchema,
  /** Model used for this block */
  model: ModelSchema.optional(),
  /** General metadata */
  metadata: z.record(z.string(), z.unknown()).optional(),
  /** Serializable error object instead of AISDKError */
  error: SerializedErrorSchema.optional()
}

const BaseMessageBlockSchema = z.object(BaseMessageBlockSchemaConfig)

// BaseMessageBlock base type - more concise, containing only essential common properties
export type BaseMessageBlock = z.infer<typeof BaseMessageBlockSchema>

export interface PlaceholderMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.UNKNOWN
}

// 主文本块 - 核心内容
export interface MainTextMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.MAIN_TEXT
  content: string
  knowledgeBaseIds?: string[]
  // Citation references
  citationReferences?: {
    citationBlockId?: string
    citationBlockSource?: WebSearchSource
  }[]
}

// 思考块 - 模型推理过程
export interface ThinkingMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.THINKING
  content: string
  thinking_millsec: number
}

// 翻译块
export interface TranslationMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.TRANSLATION
  content: string
  sourceBlockId?: string // Optional: ID of the block that was translated
  sourceLanguage?: string
  targetLanguage: string
}

// 代码块 - 专门处理代码
export interface CodeMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.CODE
  content: string
  language: string // 代码语言
}

export interface ImageMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.IMAGE
  url?: string // For generated images or direct links
  file?: FileMetadata // For user uploaded image files
  metadata?: BaseMessageBlock['metadata'] & {
    prompt?: string
    negativePrompt?: string
    generateImageResponse?: GenerateImageResponse
  }
}

// Added unified ToolBlock
export interface ToolMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.TOOL
  toolId: string
  toolName?: string
  arguments?: Record<string, any>
  content?: string | object
  metadata?: BaseMessageBlock['metadata'] & {
    rawMcpToolResponse?: MCPToolResponse | NormalToolResponse
  }
}

// Consolidated and Enhanced Citation Block
export interface CitationMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.CITATION
  response?: WebSearchResponse
  knowledge?: KnowledgeReference[]
  memories?: MemoryItem[]
}

// 文件块
export interface FileMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.FILE
  file: FileMetadata // 文件信息
}

// 视频块
export interface VideoMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.VIDEO
  url?: string // For generated video or direct links
  filePath?: string // For user uploaded video files
}

// 错误块
export interface ErrorMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.ERROR
}

// Compact块 - 用于显示 /compact 命令的响应
export interface CompactMessageBlock extends BaseMessageBlock {
  type: typeof MESSAGE_BLOCK_TYPE.COMPACT
  content: string // 总结消息
  compactedContent: string // 从 <local-command-stdout> 提取的内容
}

// MessageBlock 联合类型
export type MessageBlock =
  | PlaceholderMessageBlock
  | MainTextMessageBlock
  | ThinkingMessageBlock
  | TranslationMessageBlock
  | CodeMessageBlock
  | ImageMessageBlock
  | ToolMessageBlock
  | FileMessageBlock
  | ErrorMessageBlock
  | CitationMessageBlock
  | VideoMessageBlock
  | CompactMessageBlock

export enum UserMessageStatus {
  SUCCESS = 'success'
}

export enum AssistantMessageStatus {
  PROCESSING = 'processing',
  PENDING = 'pending',
  SEARCHING = 'searching',
  SUCCESS = 'success',
  PAUSED = 'paused',
  ERROR = 'error'
}
// Message 核心类型 - 包含元数据和块集合
export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  assistantId: string
  topicId: string
  createdAt: string
  updatedAt?: string
  status: UserMessageStatus | AssistantMessageStatus

  // 消息元数据
  modelId?: string
  model?: Model
  type?: 'clear'
  useful?: boolean
  askId?: string // 关联的问题消息ID
  mentions?: Model[]
  /**
   * @deprecated
   */
  enabledMCPs?: MCPServer[]

  usage?: Usage
  metrics?: Metrics

  // UI相关
  multiModelMessageStyle?: 'horizontal' | 'vertical' | 'fold' | 'grid'
  foldSelected?: boolean

  // 块集合
  blocks: MessageBlock['id'][]

  // 跟踪Id
  traceId?: string

  // Agent session identifier used to resume Claude Code runs
  agentSessionId?: string

  // raw data
  // TODO: add this providerMetadata to MessageBlock to save raw provider data for each block
  providerMetadata?: ProviderMetadata
}

export interface Response {
  text?: string
  reasoning_content?: string
  usage?: Usage
  metrics?: Metrics
  webSearch?: WebSearchResponse
  mcpToolResponse?: MCPToolResponse[]
  generateImage?: GenerateImageResponse
  error?: ResponseError
}

// FIXME: Weak type safety. It may be a specific class instance which inherits Error in runtime.
export type ResponseError = Record<string, any>

export interface MessageInputBaseParams {
  assistant: Assistant
  topic: Topic
  content?: string
  files?: FileMetadata[]
  knowledgeBaseIds?: string[]
  mentions?: Model[]
  /**
   * @deprecated
   */
  enabledMCPs?: MCPServer[]
  usage?: CompletionUsage
}
