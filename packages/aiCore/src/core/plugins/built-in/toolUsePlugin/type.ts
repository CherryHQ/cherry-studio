import type { Tool, ToolSet } from 'ai'

import type { AiRequestContext } from '../..'

/**
 * Parsed tool-use intent extracted from model output.
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
  // Optional custom system prompt builder.
  buildSystemPrompt?: (userSystemPrompt: string, tools: ToolSet) => string
  // Optional custom tool-use parser.
  parseToolUse?: (content: string, tools: ToolSet) => { results: ToolUseResult[]; content: string }
  mcpMode?: string
}

/**
 * Built-in provider tool shape.
 * Important: keep type='provider' for AI SDK compatibility.
 * The outbound request layer maps definition.type='builtin_function' when required by provider APIs.
 */
export type BuiltinTool = Tool & {
  type: 'provider'
  toolType?: 'builtin_function'
  isBuiltin?: boolean
  definition?: {
    type: string
    function: { name: string }
  }
}

/**
 * Extended tool registry including built-in provider tools.
 */
export type ExtendedToolSet = Record<string, BuiltinTool>

/**
 * Extended request context with prompt tools and built-in tools.
 */
export interface ToolUseRequestContext extends AiRequestContext {
  mcpTools: ToolSet
  builtinTools?: ExtendedToolSet
}
