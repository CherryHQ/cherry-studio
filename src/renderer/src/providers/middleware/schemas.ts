import { Assistant, MCPTool, Model } from '@renderer/types'
import { Chunk } from '@renderer/types/chunk'
import { Message } from '@renderer/types/newMessage'

// ============================================================================
// Core Request Types - 核心请求结构
// ============================================================================

/**
 * 标准化的内部核心请求结构，用于所有AI Provider的统一处理
 * 这是应用层参数转换后的标准格式，不包含回调函数和控制逻辑
 */
export interface CoreCompletionsRequest {
  // 基础对话数据
  messages: Message[]
  assistant: Assistant
  model: Model

  // 工具相关
  mcpTools?: MCPTool[]

  // 生成参数
  temperature?: number
  topP?: number
  maxTokens?: number

  // 功能开关
  streamOutput: boolean
  enableWebSearch?: boolean
  enableReasoning?: boolean

  // 上下文控制
  contextCount?: number

  // 任务类型标记（为未来扩展准备）
  taskType: 'completion' | 'translation' | 'summary' | 'search'

  // 特定任务的额外参数
  taskSpecificParams?: Record<string, any>
}

// ============================================================================
// Generic Chunk Types - 通用数据块结构
// ============================================================================

/**
 * 通用数据块类型
 * 复用现有的 Chunk 类型，这是所有AI Provider都应该输出的标准化数据块格式
 */
export type GenericChunk = Chunk
