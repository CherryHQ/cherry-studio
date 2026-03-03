import type { Tool, ToolSet } from 'ai'

import type { AiRequestContext } from '../..'

/**
 * 解析结果类型
 * 表示从AI响应中解析出的工具使用意图
 */
export interface ToolUseResult {
  id: string
  toolName: string
  arguments: any
  status: 'pending' | 'invoking' | 'done' | 'error'
}

export interface BaseToolUsePluginConfig {
  enabled?: boolean
}

export interface PromptToolUseConfig extends BaseToolUsePluginConfig {
  // 自定义系统提示符构建函数（可选，有默认实现）
  buildSystemPrompt?: (userSystemPrompt: string, tools: ToolSet) => string
  // 自定义工具解析函数（可选，有默认实现）
  parseToolUse?: (content: string, tools: ToolSet) => { results: ToolUseResult[]; content: string }
  mcpMode?: string
}

/**
 * 内置工具类型
 * 支持 Provider 内置工具（如 Moonshot 的 $web_search）
 */
export type BuiltinTool = Tool & {
  type: 'provider' | 'builtin'
  toolType?: 'builtin_function'
  isBuiltin?: boolean
  definition?: {
    type: string
    function: { name: string }
  }
}

/**
 * 扩展工具集合，支持标准工具和内置工具
 */
export type ExtendedToolSet = Record<string, BuiltinTool>

/**
 * 扩展的 AI 请求上下文，支持 MCP 工具存储
 */
export interface ToolUseRequestContext extends AiRequestContext {
  mcpTools: ToolSet
  builtinTools?: ExtendedToolSet
}
