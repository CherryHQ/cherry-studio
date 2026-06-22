export type ToolType = 'builtin' | 'provider' | 'mcp'

/** Common shape shared by builtin/provider tools (non-MCP) when wrapped in
 *  `NormalToolResponse`. MCP tools have the richer `McpTool` shape below. */
export interface BaseTool {
  id: string
  name: string
  description?: string
  type: ToolType
}

export type { McpTool } from '@shared/types/mcp'
