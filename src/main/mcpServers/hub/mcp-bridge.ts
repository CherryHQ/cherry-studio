/**
 * Bridge module for Hub server to access MCP tools.
 * MCPService has been removed; listAllTools returns an empty list.
 */
import type { MCPTool } from '@types'

import { buildToolNameMapping, resolveToolId, type ToolIdentity, type ToolNameMapping } from './toolname'

export const listAllTools = (): Promise<MCPTool[]> => Promise.resolve([])

let toolNameMapping: ToolNameMapping | null = null

export async function refreshToolMap(): Promise<void> {
  const tools = await listAllTools()
  syncToolMapFromTools(tools)
}

export function syncToolMapFromTools(tools: MCPTool[]): void {
  const identities: ToolIdentity[] = tools.map((tool) => ({
    id: `${tool.serverId}__${tool.name}`,
    serverName: tool.serverName,
    toolName: tool.name
  }))

  toolNameMapping = buildToolNameMapping(identities)
}

export function syncToolMapFromHubTools(tools: { id: string; serverName: string; toolName: string }[]): void {
  const identities: ToolIdentity[] = tools.map((tool) => ({
    id: tool.id,
    serverName: tool.serverName,
    toolName: tool.toolName
  }))

  toolNameMapping = buildToolNameMapping(identities)
}

export function clearToolMap(): void {
  toolNameMapping = null
}

/**
 * Call a tool by either:
 * - JS name (camelCase), e.g. "githubSearchRepos"
 * - original tool id (namespaced), e.g. "github__search_repos"
 */
export const callMcpTool = async (nameOrId: string, _params: unknown, _callId?: string): Promise<unknown> => {
  if (!toolNameMapping) {
    await refreshToolMap()
  }

  const mapping = toolNameMapping
  if (!mapping) {
    throw new Error('Tool mapping not initialized')
  }

  let toolId = resolveToolId(mapping, nameOrId)
  if (!toolId) {
    // Refresh and retry once (tools might have changed)
    await refreshToolMap()
    const refreshed = toolNameMapping
    if (!refreshed) {
      throw new Error('Tool mapping not initialized')
    }
    toolId = resolveToolId(refreshed, nameOrId)
  }

  if (!toolId) {
    throw new Error(`Tool not found: ${nameOrId}`)
  }

  throw new Error(`MCPService is unavailable; cannot call tool: ${toolId}`)
}

export const abortMcpTool = async (_callId: string): Promise<boolean> => {
  return false
}
