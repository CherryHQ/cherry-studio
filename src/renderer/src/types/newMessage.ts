import type { CompletionUsage } from '@cherrystudio/openai/resources'
import type { ProviderMetadata } from 'ai'
import * as z from 'zod'

import {
  type Assistant,
  type FileMetadata,
  FileMetadataSchema,
  type GenerateImageResponse,
  GenerateImageResponseSchema,
  KnowledgeReferenceSchema,
  type MCPServer,
  type MCPToolResponse,
  MCPToolResponseSchema,
  MemoryItemSchema,
  type Metrics,
  type Model,
  ModelSchema,
  NormalToolResponseSchema,
  objectValues,
  type Topic,
  type Usage,
  type WebSearchResponse,
  WebSearchResponseSchema,
  WebSearchSourceSchema
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

const PlaceholderMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.UNKNOWN)
})

export type PlaceholderMessageBlock = z.infer<typeof PlaceholderMessageBlockSchema>

// 主文本块 - 核心内容
const MainTextMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.MAIN_TEXT),
  content: z.string(),
  knowledgeBaseIds: z.array(z.string()).optional(),
  citationReferences: z
    .array(
      z.object({
        citationBlockId: z.string().optional(),
        citationBlockSource: WebSearchSourceSchema.optional()
      })
    )
    .optional()
})

export type MainTextMessageBlock = z.infer<typeof MainTextMessageBlockSchema>

// 思考块 - 模型推理过程
const ThinkingMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.THINKING),
  content: z.string(),
  thinking_millsec: z.number()
})

export type ThinkingMessageBlock = z.infer<typeof ThinkingMessageBlockSchema>

// 翻译块
const TranslationMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.TRANSLATION),
  content: z.string(),
  /** ID of the block that was translated */
  sourceBlockId: z.string().optional(),
  sourceLanguage: z.string().optional(),
  targetLanguage: z.string()
})

export type TranslationMessageBlock = z.infer<typeof TranslationMessageBlockSchema>

// 代码块 - 专门处理代码
const CodeMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.CODE),
  content: z.string(),
  /** Coding language */
  language: z.string()
})

export type CodeMessageBlock = z.infer<typeof CodeMessageBlockSchema>

const ImageMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.IMAGE),
  url: z.string().optional(),
  file: FileMetadataSchema.optional(),
  metadata: z
    .object({
      prompt: z.string().optional(),
      negativePrompt: z.string().optional(),
      generateImageResponse: GenerateImageResponseSchema.optional()
    })
    .catchall(z.unknown())
    .optional()
})

// Added unified ImageBlock
export type ImageMessageBlock = z.infer<typeof ImageMessageBlockSchema>

const ToolMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.TOOL),
  toolId: z.string(),
  toolName: z.string().optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  content: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  metadata: z
    .object({
      rawMcpToolResponse: z.union([MCPToolResponseSchema, NormalToolResponseSchema]).optional()
    })
    .catchall(z.unknown())
    .optional()
})

// Added unified ToolBlock
export type ToolMessageBlock = z.infer<typeof ToolMessageBlockSchema>

// Consolidated and Enhanced Citation Block
const CitationMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.CITATION),
  response: WebSearchResponseSchema.optional(),
  knowledge: z.array(KnowledgeReferenceSchema).optional(),
  memories: z.array(MemoryItemSchema).optional()
})

export type CitationMessageBlock = z.infer<typeof CitationMessageBlockSchema>

// 文件块
const FileMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.FILE),
  file: FileMetadataSchema
})

export type FileMessageBlock = z.infer<typeof FileMessageBlockSchema>

// 视频块
const VideoMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.VIDEO),
  // For generated video or direct links
  url: z.string().optional(),
  // For user uploaded video files
  filePath: z.string().optional()
})

export type VideoMessageBlock = z.infer<typeof VideoMessageBlockSchema>

// 错误块
const ErrorMessageBlockSchema = z.object({
  ...BaseMessageBlockSchemaConfig,
  type: z.literal(MESSAGE_BLOCK_TYPE.ERROR)
})

export type ErrorMessageBlock = z.infer<typeof ErrorMessageBlockSchema>

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
