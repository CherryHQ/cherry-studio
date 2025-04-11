import type { GroundingMetadata } from '@google/generative-ai'
import type OpenAI from 'openai'

// import type { Annotation as OpenAIAnnotation } from 'openai/resources/chat/completions' // REMOVED
import type {
  FileType,
  GenerateImageResponse,
  MCPServer,
  MCPToolResponse,
  Metrics,
  Model,
  Topic,
  WebSearchResult
} from '.'
// MessageBlock 类型枚举 - 根据实际API返回特性优化
export enum MessageBlockType {
  MAIN_TEXT = 'main_text', // 主要文本内容
  THINKING = 'thinking', // 思考过程（Claude、OpenAI-o系列等）
  TRANSLATION = 'translation', // Re-added
  IMAGE = 'image', // 图片内容
  CODE = 'code', // 代码块
  TOOL = 'tool', // Added unified tool block type
  WEB_SEARCH = 'web_search', // 网页搜索结果
  FILE = 'file', // 文件内容
  ERROR = 'error', // 错误信息
  CITATION = 'citation' // 引用类型
}

// 块状态定义 - 更细粒度地表达处理状态
export enum MessageBlockStatus {
  PENDING = 'pending', // 等待处理
  PROCESSING = 'processing', // 正在处理
  STREAMING = 'streaming', // 正在流式接收
  SUCCESS = 'success', // 处理成功
  ERROR = 'error', // 处理错误
  PAUSED = 'paused' // 处理暂停
}

// BaseMessageBlock 基础类型 - 更简洁，只包含必要通用属性
export interface BaseMessageBlock {
  id: string // 块ID
  messageId: string // 所属消息ID
  type: MessageBlockType // 块类型
  createdAt: string // 创建时间
  updatedAt?: string // 更新时间
  status: MessageBlockStatus // 块状态
  model?: Model // 使用的模型
  metadata?: Record<string, any> // 通用元数据
  error?: Record<string, any> // Added optional error field to base
}

// 主文本块 - 核心内容
export interface MainTextMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.MAIN_TEXT
  content: string
  usage?: OpenAI.Completions.CompletionUsage
  metrics?: Metrics
  knowledgeBaseIds?: string[]
}

// 思考块 - 模型推理过程
export interface ThinkingMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.THINKING
  content: string
}

// 翻译块
export interface TranslationMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.TRANSLATION
  content: string
  sourceBlockId?: string // Optional: ID of the block that was translated
  sourceLanguage?: string
  targetLanguage: string
}

// 代码块 - 专门处理代码
export interface CodeMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.CODE
  content: string
  language: string // 代码语言
}

export interface ImageMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.IMAGE
  url?: string // For generated images or direct links
  file?: FileType // For user uploaded image files
  metadata?: BaseMessageBlock['metadata'] & {
    prompt?: string
    negativePrompt?: string
    generateImageResponse?: GenerateImageResponse
  }
}

// Added unified ToolBlock
export interface ToolBlock extends BaseMessageBlock {
  type: MessageBlockType.TOOL
  toolId: string
  toolName?: string
  arguments?: Record<string, any>
  content?: string | object
  metadata?: BaseMessageBlock['metadata'] & {
    rawMcpToolResponse?: MCPToolResponse
  }
}

// Consolidated Citation Block
export interface CitationBlock extends BaseMessageBlock {
  type: MessageBlockType.CITATION
  citationType: 'grounding' | 'citation' | 'annotation' | 'webSearchInfo'
  originalData: any
  sourceName?: string

  groundingMetadata?: GroundingMetadata
  citations?: string[]
  annotations?: OpenAI.Chat.Completions.ChatCompletionMessage.Annotation[]
  webSearchInfo?: any
}

// 网页搜索结果块
export interface WebSearchMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.WEB_SEARCH
  query?: string
  results: WebSearchResult[]
}

// 文件块
export interface FileMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.FILE
  file: FileType // 文件信息
}
// 错误块
export interface ErrorMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.ERROR
}

// MessageBlock 联合类型
export type MessageBlock =
  | MainTextMessageBlock
  | ThinkingMessageBlock
  | TranslationMessageBlock
  | CodeMessageBlock
  | ImageMessageBlock
  | ToolBlock
  | WebSearchMessageBlock
  | FileMessageBlock
  | ErrorMessageBlock
  | CitationBlock

// Message 核心类型 - 包含元数据和块集合
export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  assistantId: string
  topicId: string
  createdAt: string
  // updatedAt?: string
  status: 'sending' | 'processing' | 'success' | 'paused' | 'error'

  // 消息元数据
  modelId?: string
  model?: Model
  type: 'text' | '@' | 'clear'
  isPreset?: boolean
  useful?: boolean
  askId?: string // 关联的问题消息ID
  mentions?: Model[]
  enabledMCPs?: MCPServer[]

  // UI相关
  multiModelMessageStyle?: 'horizontal' | 'vertical' | 'fold' | 'grid'
  foldSelected?: boolean

  // 块集合
  blocks: MessageBlock['id'][]
}

export interface MessagesState {
  messagesByTopic: Record<string, Message[]>
  currentTopic: Topic | null
  loadingByTopic: Record<string, boolean>
  displayCount: number
  error: string | null
}
