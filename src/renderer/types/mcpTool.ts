import type { McpServer } from '@shared/data/types/mcpServer'

import type { KnowledgeReference } from './knowledge'
import type { MemoryItem } from './memory'
import type { BaseTool, McpTool } from './tool'
import type { WebSearchResponse } from './webSearchProvider'

export interface McpConfig {
  servers: McpServer[]
  isUvInstalled: boolean
  isBunInstalled: boolean
}

export type McpToolResponseStatus = 'pending' | 'streaming' | 'cancelled' | 'invoking' | 'done' | 'error'

interface BaseToolResponse {
  id: string // unique id
  tool: BaseTool | McpTool
  arguments: Record<string, unknown> | Record<string, unknown>[] | string | undefined
  status: McpToolResponseStatus
  response?: any
  // Streaming arguments support
  partialArguments?: string // Accumulated partial JSON string during streaming
}

export interface ToolUseResponse extends BaseToolResponse {
  toolUseId: string
}

export interface ToolCallResponse extends BaseToolResponse {
  // gemini tool call id might be undefined
  toolCallId?: string
}

export interface McpToolResponse extends Omit<ToolUseResponse | ToolCallResponse, 'tool'> {
  tool: McpTool
  toolCallId?: string
  toolUseId?: string
  parentToolUseId?: string
}

export interface NormalToolResponse extends Omit<ToolCallResponse, 'tool'> {
  tool: BaseTool
  toolCallId: string
  parentToolUseId?: string
}

export type ExternalToolResult = {
  mcpTools?: McpTool[]
  toolUse?: McpToolResponse[]
  webSearch?: WebSearchResponse
  knowledge?: KnowledgeReference[]
  memories?: MemoryItem[]
}
