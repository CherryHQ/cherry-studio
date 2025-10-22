import * as z from 'zod'

import { KnowledgeReference } from './knowledge'
import { MemoryItem } from './memory'
import { WebSearchResponse } from './websearch'

export type ToolType = 'builtin' | 'provider' | 'mcp'

export interface BaseTool {
  id: string
  name: string
  description?: string
  type: ToolType
}

export const MCPToolOutputSchema = z
  .object({
    type: z.literal('object'),
    properties: z.object({}).loose().optional(),
    required: z.array(z.string()).optional()
  })
  .loose()

export const MCPToolInputSchema = z
  .object({
    type: z.literal('object'),
    properties: z.object({}).loose().optional(),
    required: z.array(z.string()).optional()
  })
  .loose()

export interface BuiltinTool extends BaseTool {
  inputSchema: z.infer<typeof MCPToolInputSchema>
  type: 'builtin'
}

export interface MCPTool extends BaseTool {
  id: string
  serverId: string
  serverName: string
  name: string
  description?: string
  inputSchema: z.infer<typeof MCPToolInputSchema>
  outputSchema?: z.infer<typeof MCPToolOutputSchema>
  isBuiltIn?: boolean // 标识是否为内置工具，内置工具不需要通过MCP协议调用
  type: 'mcp'
}

export type MCPToolResponseStatus = 'pending' | 'cancelled' | 'invoking' | 'done' | 'error'

interface BaseToolResponse {
  id: string // unique id
  tool: BaseTool | MCPTool
  arguments: Record<string, unknown> | Record<string, unknown>[] | string | undefined
  status: MCPToolResponseStatus
  response?: any
}

export interface ToolUseResponse extends BaseToolResponse {
  toolUseId: string
}

export interface ToolCallResponse extends BaseToolResponse {
  // gemini tool call id might be undefined
  toolCallId?: string
}

// export type MCPToolResponse = ToolUseResponse | ToolCallResponse
export interface MCPToolResponse extends Omit<ToolUseResponse | ToolCallResponse, 'tool'> {
  tool: MCPTool
  toolCallId?: string
  toolUseId?: string
}

export interface NormalToolResponse extends Omit<ToolCallResponse, 'tool'> {
  tool: BaseTool
  toolCallId: string
}

export interface MCPToolResultContent {
  type: 'text' | 'image' | 'audio' | 'resource'
  text?: string
  data?: string
  mimeType?: string
  resource?: {
    uri?: string
    text?: string
    mimeType?: string
    blob?: string
  }
}

export interface MCPCallToolResponse {
  content: MCPToolResultContent[]
  isError?: boolean
}

export type ExternalToolResult = {
  mcpTools?: MCPTool[]
  toolUse?: MCPToolResponse[]
  webSearch?: WebSearchResponse
  knowledge?: KnowledgeReference[]
  memories?: MemoryItem[]
}
