/**
 * Bridge module for Hub server to access MCPService.
 */
import mcpService from '@main/services/MCPService'
import type { MCPCallToolResponse, MCPTool, MCPToolResultContent } from '@types'

import { buildToolNameMapping, resolveToolId, type ToolIdentity, type ToolNameMapping } from './toolname'

export const listAllTools = () => mcpService.listAllActiveServerTools()

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
export const callMcpTool = async (nameOrId: string, params: unknown, callId?: string): Promise<unknown> => {
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

  const result = await mcpService.callToolById(toolId, params, callId)
  throwIfToolError(result)
  return extractToolResult(result)
}

export const abortMcpTool = async (callId: string): Promise<boolean> => {
  return mcpService.abortTool(null as unknown as Electron.IpcMainInvokeEvent, callId)
}

function extractToolResult(result: MCPCallToolResponse): unknown {
  if (!result.content || result.content.length === 0) {
    return null
  }

  const textContent = result.content.find((c) => c.type === 'text')
  if (textContent?.text) {
    try {
      return JSON.parse(textContent.text)
    } catch {
      return textContent.text
    }
  }

  return result.content
}

function throwIfToolError(result: MCPCallToolResponse): void {
  if (!result.isError) {
    return
  }

  const textContent = extractTextContent(result.content)
  throw new Error(textContent ?? 'Tool execution failed')
}

function extractTextContent(content: MCPToolResultContent[] | undefined): string | undefined {
  if (!content || content.length === 0) {
    return undefined
  }

  const textBlock = content.find((item) => item.type === 'text' && item.text)
  return textBlock?.text
}
