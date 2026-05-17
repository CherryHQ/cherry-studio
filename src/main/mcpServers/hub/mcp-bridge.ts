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
 * Resolve a hub tool JS name (or namespaced id) to its original serverId and toolName.
 * Returns null if the name cannot be resolved.
 */
export function resolveHubToolName(nameOrId: string): { serverId: string; toolName: string } | null {
  if (!toolNameMapping) return null

  const toolId = resolveToolId(toolNameMapping, nameOrId)
  if (!toolId) return null

  const separatorIndex = toolId.indexOf('__')
  if (separatorIndex === -1) return null

  return {
    serverId: toolId.substring(0, separatorIndex),
    toolName: toolId.substring(separatorIndex + 2)
  }
}

/**
 * Async version of resolveHubToolName that lazily refreshes the tool mapping
 * if it has been cleared (e.g., after cache invalidation).
 */
export async function resolveHubToolNameAsync(
  nameOrId: string
): Promise<{ serverId: string; toolName: string } | null> {
  if (!toolNameMapping) {
    await refreshToolMap()
  }

  const result = resolveHubToolName(nameOrId)
  if (!result && toolNameMapping) {
    // Mapping exists but tool not found — refresh once and retry
    await refreshToolMap()
    return resolveHubToolName(nameOrId)
  }

  return result
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
    // Some MCP tools deliver their payload exclusively via structuredContent
    // with an empty content array; surface it instead of returning null.
    if (result.structuredContent !== undefined && result.structuredContent !== null) {
      return result.structuredContent
    }

    return null
  }

  const textBlocks = result.content.filter(
    (item): item is MCPToolResultContent & { type: 'text'; text: string } =>
      item.type === 'text' && typeof item.text === 'string'
  )

  // Non-text-only (image/audio/resource) or mixed (text + non-text): return
  // the first text block when present, otherwise the raw array. Proper
  // multimodal content handling (base64 placeholders, etc.) is tracked in
  // #13209; expanding that here would risk base64 payloads being serialized
  // into LLM messages (see #12735).
  if (textBlocks.length !== result.content.length) {
    if (textBlocks.length === 0) {
      return result.content
    }
    try {
      return JSON.parse(textBlocks[0].text)
    } catch {
      return textBlocks[0].text
    }
  }

  // Single text block keeps the historical behavior so `exec` user code that
  // accesses parsed object fields directly continues to work unchanged.
  if (textBlocks.length === 1) {
    try {
      return JSON.parse(textBlocks[0].text)
    } catch {
      return textBlocks[0].text
    }
  }

  // Multi-block responses: previously only `content[0]` was returned, silently
  // dropping every block after the first. Parse each block and return them as
  // an array so the full payload reaches both `invoke` and `exec`.
  return textBlocks.map((block) => {
    try {
      return JSON.parse(block.text)
    } catch {
      return block.text
    }
  })
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

  // Join every text block so multi-block error payloads surface in full
  // instead of being truncated to the first block.
  const textParts = content
    .filter(
      (item): item is MCPToolResultContent & { type: 'text'; text: string } =>
        item.type === 'text' && typeof item.text === 'string' && item.text.length > 0
    )
    .map((item) => item.text)

  return textParts.length > 0 ? textParts.join('\n') : undefined
}
