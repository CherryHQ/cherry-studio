import { ToolSet } from 'ai'

import { AiRequestContext } from '../..'

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
  createSystemMessage?: (systemPrompt: string, originalParams: any, context: AiRequestContext) => string | null
}

/**
 * 扩展的 AI 请求上下文，支持 MCP 工具存储
 */
export interface ToolUseRequestContext extends AiRequestContext {
  mcpTools: ToolSet
}
