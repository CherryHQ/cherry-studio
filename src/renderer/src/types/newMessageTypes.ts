import type OpenAI from 'openai'

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
  TRANSLATION = 'translation', // 翻译内容
  IMAGE = 'image', // 图片内容
  CODE = 'code', // 代码块
  TOOL_CALL = 'tool_call', // 工具调用
  TOOL_RESULT = 'tool_result', // 工具调用结果
  KNOWLEDGE_CITATION = 'knowledge_citation', // 知识库引用
  WEB_SEARCH = 'web_search', // 网页搜索结果
  FILE = 'file', // 文件内容
  ERROR = 'error' // 错误信息
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
  error?: string // 错误信息
  content?: string | object // 通用内容字段（可选，由子类型实现具体内容）
  metadata?: Record<string, any> // 通用元数据
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
  budgetTokens?: number // 思考预算的token数量
}

// 翻译块
export interface TranslationMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.TRANSLATION
  content: string
  sourceBlockId: string
  sourceLanguage: string
  targetLanguage: string
}

// 代码块 - 专门处理代码
export interface CodeMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.CODE
  content: string
  language: string // 代码语言
  isExecutable?: boolean // 是否可执行
  executionResult?: string // 执行结果
}

// 图片块
export interface ImageMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.IMAGE
  url: string // 图片URL
  base64Data?: string // Base64图片数据（可选）
  mimeType?: string // MIME类型
  width?: number // 宽度
  height?: number // 高度
  caption?: string // 图片描述
  promptId?: string // 生成图片的提示ID
  metadata?: {
    generateImage?: GenerateImageResponse
  }
}

// 工具调用块
export interface ToolCallMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.TOOL_CALL
  toolId: string // 工具ID
  toolName: string // 工具名称
  arguments: Record<string, any> // 工具参数
  toolResponse?: MCPToolResponse // 工具响应
}

// 工具结果块
export interface ToolResultMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.TOOL_RESULT
  toolCallId: string // 对应工具调用ID
  content: string | object // 工具返回结果
  error?: string // 错误信息
}

// 知识库引用块
export interface KnowledgeCitationMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.KNOWLEDGE_CITATION
  citations: Array<{
    id: string // 引用ID
    content: string // 引用内容
    source: string // 引用来源
    similarity?: number // 相似度
  }>
}

// 网页搜索结果块
export interface WebSearchMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.WEB_SEARCH
  query: string // 搜索查询
  results: WebSearchResult[] // 搜索结果
  provider?: string // 搜索提供商
}

// 文件块
export interface FileMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.FILE
  file: FileType // 文件信息
  previewText?: string // 文件预览文本
}

// 错误块
export interface ErrorMessageBlock extends BaseMessageBlock {
  type: MessageBlockType.ERROR
  content: string // 错误消息
  errorCode?: string // 错误代码
  recoverable?: boolean // 是否可恢复
}

// MessageBlock 联合类型
export type MessageBlock =
  | MainTextMessageBlock
  | ThinkingMessageBlock
  | TranslationMessageBlock
  | CodeMessageBlock
  | ImageMessageBlock
  | ToolCallMessageBlock
  | ToolResultMessageBlock
  | KnowledgeCitationMessageBlock
  | WebSearchMessageBlock
  | FileMessageBlock
  | ErrorMessageBlock

// 流式块更新数据结构 - 用于处理API流式更新
export interface BlockUpdateData {
  blockId?: string // 要更新的块ID (如果为空则创建新块)
  messageId: string // 所属消息ID
  type: MessageBlockType // 块类型
  content?: string | object // 内容更新
  status?: MessageBlockStatus // 状态更新
  append?: boolean // 是否追加内容
  language?: string // 代码语言 (用于代码块)
  metadata?: Record<string, any> // 元数据更新
  usage?: OpenAI.Completions.CompletionUsage // 使用统计
  metrics?: Metrics // 性能指标
}

// Message 核心类型 - 包含元数据和块集合
export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  assistantId: string
  topicId: string
  createdAt: string
  updatedAt?: string
  status: 'sending' | 'processing' | 'success' | 'paused' | 'error'

  // 兼容性和快速访问字段
  content?: string // 主文本内容快捷引用 (映射到MAIN_TEXT块)

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
  blocks: {
    id: MessageBlock['id']
    timestamp: number
  }[]
}

// Redux状态类型
export type MessagesState = {
  messagesByTopic: Record<string, Message[]>
  streamBlocksByMessage: Record<string, Record<string, MessageBlock>> // 流式更新的块缓存
  currentTopic: Topic | null
  loadingByTopic: Record<string, boolean>
  displayCount: number
  error: string | null
}
