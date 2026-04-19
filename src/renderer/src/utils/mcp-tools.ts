import { hubMCPServer } from '@renderer/store/mcp'
import type { MCPServer, MCPTool } from '@renderer/types'

/**
 * Pure lookup: find the MCP server a tool belongs to within an already-
 * loaded server list. Falls back to the built-in hub constant for tools
 * tagged `serverId: 'hub'` (the hub isn't stored in the DB).
 */
export function findMcpServerByTool(servers: MCPServer[], tool: MCPTool): MCPServer | undefined {
  const server = servers.find((s) => s.id === tool.serverId)
  if (server) return server
  if (tool.serverId === 'hub') return hubMCPServer
  return undefined
}

/**
 * Pure predicate — callers that already hold the server (e.g. settings pages
 * rendering a server's own tool list) use this form directly. Callers that
 * only have a tool should use `useIsToolAutoApproved` so the server lookup
 * goes through the DataApi SWR cache.
 */
export function isToolAutoApproved(tool: MCPTool, server?: MCPServer, allowedTools?: string[]): boolean {
  if (tool.isBuiltIn) return true
  if (allowedTools?.includes(tool.id)) return true
  if (!server) return false
  // Hub meta-tools: read-only tools (list, inspect) are auto-approved;
  // execution tools (invoke, exec) require approval.
  if (server.id === 'hub') return tool.name === 'list' || tool.name === 'inspect'
  return !server.disabledAutoApproveTools?.includes(tool.name)
}
