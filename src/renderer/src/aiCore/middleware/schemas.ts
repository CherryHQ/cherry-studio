import { Assistant, MCPTool } from '@renderer/types'
import { Chunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'
import { SdkRawChunk, SdkRawOutput } from '@renderer/types/sdk'

import { ProcessingState } from './types'

// ============================================================================
// Core Request Types - 核心请求结构
// ============================================================================

/**
 * 标准化的内部核心请求结构，用于所有AI Provider的统一处理
 * 这是应用层参数转换后的标准格式，不包含回调函数和控制逻辑
 */
export interface CompletionsParams {
  /**
   * 调用的业务场景类型，用于中间件判断是否执行
   * 'chat': 主要对话流程
   * 'translate': 翻译
   * 'summary': 摘要
   * 'search': 搜索摘要
   * 'generate': 生成
   * 'check': API检查
   */
  callType?: 'chat' | 'translate' | 'summary' | 'search' | 'generate' | 'check' | 'test'

  // 基础对话数据
  messages: Message[] | string // 联合类型方便判断是否为空

  assistant: Assistant // 助手为基本单位
  // model: Model

  onChunk?: (chunk: Chunk) => void
  onResponse?: (text: string, isComplete: boolean) => void

  // 错误相关
  onError?: (error: Error) => void
  shouldThrow?: boolean

  // 工具相关
  mcpTools?: MCPTool[]

  // 生成参数
  temperature?: number
  topP?: number
  maxTokens?: number

  // 功能开关
  streamOutput: boolean
  enableWebSearch?: boolean
  enableUrlContext?: boolean
  enableReasoning?: boolean
  enableGenerateImage?: boolean

  // 上下文控制
  contextCount?: number

  _internal?: ProcessingState
}

export interface CompletionsResult {
  rawOutput?: SdkRawOutput
  stream?: ReadableStream<SdkRawChunk> | ReadableStream<Chunk> | AsyncIterable<Chunk>
  controller?: AbortController

  getText: () => string
}

// ============================================================================
// Generic Chunk Types - 通用数据块结构
// ============================================================================

/**
 * 通用数据块类型
 * 复用现有的 Chunk 类型，这是所有AI Provider都应该输出的标准化数据块格式
 */
export type GenericChunk = Chunk
