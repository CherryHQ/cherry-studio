import { createHash } from 'node:crypto'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import { loggerService } from '@logger'
import type { AgentMcpServer } from '@main/ai/runtime/agentMcpServers'
import { newCitePrefix } from '@main/ai/utils/citationIds'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult, ContentBlock, Tool } from '@modelcontextprotocol/sdk/types.js'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'

const logger = loggerService.withContext('PiMcpToolAdapter')
type PiToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }

/** MCP keeps result schemas separately from tool-call parameters. Preserve that distinction for code-mode declarations. */
export type PiMcpToolDefinition = ToolDefinition & { outputSchema?: unknown }

class PiMcpToolIdentityError extends Error {}

export interface PiMcpToolBridge {
  tools: PiMcpToolDefinition[]
  close(): Promise<void>
}

/** Preserve MCP wire names when provider-safe; sanitize only names that cannot be sent as functions. */
export function buildPiMcpToolName(serverName: string, toolName: string): string {
  const wireName = `mcp__${serverName}__${toolName}`
  if (/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(wireName)) return wireName

  const prefix = `mcp__${toCamelCase(serverName)}__${toCamelCase(toolName)}`.replace(/[^A-Za-z0-9_-]/g, '')
  const hash = createHash('sha256').update(`${serverName}\0${toolName}`).digest('hex').slice(0, 12)
  const safePrefix = /^[A-Za-z_]/.test(prefix) ? prefix : `mcp_${prefix}`
  return `${safePrefix.slice(0, 50)}_${hash}`
}

/** Warm user-configured MCP catalogs before their in-process bridge takes its initial tool snapshot. */
export async function warmMcpToolCatalogs(mcpIds: readonly string[]): Promise<void> {
  const catalog = application.get('McpCatalogService')
  const serverIds = new Set<string>()
  for (const idOrName of mcpIds) {
    const server = mcpServerService.findByIdOrName(idOrName)
    if (!server) {
      logger.warn('Skipping unresolvable MCP server referenced by agent', { idOrName })
      continue
    }
    serverIds.add(server.id)
  }
  await Promise.allSettled([...serverIds].map((serverId) => catalog.refreshTools(serverId)))
}

/** Adapt every MCP server assembled for the session into Pi custom tools over an in-memory transport. */
export async function buildMcpToolDefinitions(servers: Record<string, AgentMcpServer>): Promise<PiMcpToolBridge> {
  const clients: Client[] = []
  const tools: PiMcpToolDefinition[] = []

  for (const [serverId, server] of Object.entries(servers)) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: `cherry-pi-${serverId}`, version: '1.0.0' }, { capabilities: {} })
    try {
      await server.instance.connect(serverTransport)
      await client.connect(clientTransport)
      const result = await client.listTools()
      const serverTools = result.tools.map((tool) => toPiToolDefinition(server.name, tool, client))
      const existingNames = new Set(tools.map((tool) => tool.name))
      const serverNames = new Set<string>()
      for (const tool of serverTools) {
        if (existingNames.has(tool.name) || serverNames.has(tool.name)) {
          throw new PiMcpToolIdentityError(`Duplicate Pi MCP tool name: ${tool.name}`)
        }
        serverNames.add(tool.name)
      }
      clients.push(client)
      tools.push(...serverTools)
    } catch (error) {
      await client.close().catch(() => undefined)
      if (error instanceof PiMcpToolIdentityError) {
        await Promise.allSettled(clients.map((connected) => connected.close()))
        throw error
      }
      logger.warn('Skipping unavailable MCP server for Pi session', { serverId, error })
    }
  }

  return {
    tools,
    async close() {
      await Promise.allSettled(clients.map((client) => client.close()))
    }
  }
}

function toPiToolDefinition(serverName: string, tool: Tool, client: Client): PiMcpToolDefinition {
  return {
    name: buildPiMcpToolName(serverName, tool.name),
    label: tool.name,
    description: tool.description ?? '',
    parameters: tool.inputSchema as ToolDefinition['parameters'],
    ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
    async execute(_toolCallId, params, signal) {
      const result = (await client.callTool(
        { name: tool.name, arguments: params as Record<string, unknown> },
        undefined,
        { signal }
      )) as CallToolResult
      if (result.isError) throw new Error(joinErrorText(result.content))
      const structured = result.structuredContent ?? tryParseStructuredFromText(result.content)
      const normalized = normalizeSearchOutput(structured)
      return {
        content: result.content.map(toPiContent),
        // Prefer normalized output (with injected citation IDs) over raw structuredContent.
        // The MCP SDK requires structuredContent to be a record, but our normalized
        // output is an array — store it directly in details, bypassing structuredContent.
        details: normalized ?? result.structuredContent ?? null
      }
    }
  }
}

function toPiContent(part: ContentBlock): PiToolContent {
  switch (part.type) {
    case 'text':
      return { type: 'text', text: part.text }
    case 'image':
      return { type: 'image', data: part.data, mimeType: part.mimeType }
    case 'audio':
      return { type: 'text', text: `[audio content (${part.mimeType})]` }
    case 'resource':
      return { type: 'text', text: flattenResource(part.resource) }
    case 'resource_link':
      return { type: 'text', text: `[resource: ${part.uri}${part.mimeType ? ` (${part.mimeType})` : ''}]` }
  }
}

function flattenResource(resource: Extract<ContentBlock, { type: 'resource' }>['resource']): string {
  if ('text' in resource) return resource.text
  return `[resource: ${resource.uri}${resource.mimeType ? ` (${resource.mimeType})` : ''}]`
}

function joinErrorText(content: CallToolResult['content']): string {
  const text = content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n')
  return text || 'MCP tool returned an error'
}

// ── Search-output normalization ──────────────────────────────────────

const URL_FIELD_NAMES = ['url', 'href', 'link', 'uri', 'source', 'webpage_url']
const TITLE_FIELD_NAMES = ['title', 'name', 'heading']
const CONTENT_FIELD_NAMES = ['content', 'description', 'snippet', 'text', 'summary']

function isHttpUrl(value: unknown): boolean {
  return typeof value === 'string' && /^https?:\/\//i.test(value)
}

function findField(obj: Record<string, unknown>, candidates: readonly string[]): string | undefined {
  for (const name of candidates) {
    if (name in obj && typeof obj[name] === 'string') return obj[name]
  }
  return undefined
}

/**
 * Detect search-like MCP output (an array of objects with URL fields) and
 * normalize it into `webSearchOutputSchema` format with injected citation IDs,
 * so the renderer's citation resolver can resolve `[cite:id]` markers.
 */
function normalizeSearchOutput(data: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(data) || data.length === 0) return null
  const items = data.filter(
    (item): item is Record<string, unknown> => typeof item === 'object' && item !== null && !Array.isArray(item)
  )
  if (items.length === 0) return null
  // Require at least one item to have a URL-like field value.
  const hasUrls = items.some((item) => URL_FIELD_NAMES.some((field) => isHttpUrl(item[field])))
  if (!hasUrls) return null

  const prefix = newCitePrefix()
  return items.map((item, index) => {
    const url = findField(item, URL_FIELD_NAMES) ?? ''
    const title = findField(item, TITLE_FIELD_NAMES) ?? ''
    const content = findField(item, CONTENT_FIELD_NAMES) ?? ''
    return { id: `${prefix}-${index + 1}`, title, url, content }
  })
}

/**
 * Try to parse structured search results from MCP text content blocks.
 * Returns the first JSON-parsed array of objects, or null.
 */
function tryParseStructuredFromText(content: CallToolResult['content']): unknown {
  for (const part of content) {
    if (part.type !== 'text') continue
    try {
      const parsed = JSON.parse(part.text)
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    } catch {
      // Not JSON — skip
    }
  }
  return null
}
