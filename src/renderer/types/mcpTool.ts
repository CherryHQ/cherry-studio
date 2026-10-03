import type { McpServer } from '@shared/data/types/mcpServer'

import type { BaseTool, McpTool } from './tool'

export interface McpConfig {
  servers: McpServer[]
  isUvInstalled: boolean
  isBunInstalled: boolean
}

export type McpToolResponseStatus = 'pending' | 'streaming' | 'cancelled' | 'invoking' | 'done' | 'error'

export interface ToolApprovalOutcome {
  approved: boolean
  reason?: string
}

interface BaseToolResponse {
  id: string // unique id
  tool: BaseTool | McpTool
  arguments: Record<string, unknown> | Record<string, unknown>[] | string | undefined
  status: McpToolResponseStatus
  response?: any
  approval?: ToolApprovalOutcome
  // Streaming arguments support
  partialArguments?: string // Accumulated partial JSON string during streaming
  /** Tool-output metadata persisted with the part (e.g. `cherry.launchToolCallId`). */
  resultProviderMetadata?: unknown
}

export interface McpToolResponse extends Omit<BaseToolResponse, 'tool'> {
  tool: McpTool
  // gemini tool call id might be undefined
  toolCallId?: string
  toolUseId?: string
  parentToolUseId?: string
}

export interface NormalToolResponse extends Omit<BaseToolResponse, 'tool'> {
  tool: BaseTool
  toolCallId: string
  parentToolUseId?: string
}
