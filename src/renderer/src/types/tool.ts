import type { MCPToolInputSchema } from './index'

export type ToolType = 'builtin' | 'provider' | 'mcp'

export interface BaseTool {
  id: string
  name: string
  description?: string
  type: ToolType
}

export interface GenericProviderTool extends BaseTool {
  type: 'provider'
}

export interface BuiltinTool extends BaseTool {
  inputSchema: MCPToolInputSchema
  type: 'builtin'
}

export interface MCPTool extends BaseTool {
  serverId: string
  serverName: string
  inputSchema: MCPToolInputSchema
  type: 'mcp'
}
