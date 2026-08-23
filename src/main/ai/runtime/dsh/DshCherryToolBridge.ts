import { createHash } from 'node:crypto'

import { application } from '@application'
import type { BridgeToolCallResult, BridgeToolDescriptor } from '@cherrystudio/dsh-bridge'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import type { AgentMcpServer } from '@main/ai/runtime/agentMcpServers'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { CallToolResult, Tool } from '@modelcontextprotocol/sdk/types.js'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'

import { dshToolResultErrorText, projectDshToolResult } from './dshToolResultProjection'

const logger = loggerService.withContext('DshCherryToolBridge')

class DshCherryToolIdentityError extends Error {}

interface DshToolBinding {
  client: Client
  rawName: string
}

export interface DshCherryToolBridge {
  tools: BridgeToolDescriptor[]
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<BridgeToolCallResult>
  close(): Promise<void>
}

export interface DshCherryToolBridgeOptions {
  agentsDataRoot: string
  toolResultRoot: string
}

/** Preserve MCP wire names when provider-safe; use a stable hash only after lossy normalization. */
export function buildDshCherryToolName(serverName: string, toolName: string): string {
  const wireName = `mcp__${serverName}__${toolName}`
  if (/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(wireName)) return wireName

  const prefix = `mcp__${toCamelCase(serverName)}__${toCamelCase(toolName)}`.replace(/[^A-Za-z0-9_-]/g, '')
  const hash = createHash('sha256').update(`${serverName}\0${toolName}`).digest('hex').slice(0, 12)
  const safePrefix = /^[A-Za-z_]/.test(prefix) ? prefix : `mcp_${prefix}`
  return `${safePrefix.slice(0, 50)}_${hash}`
}

export const DSH_AUTO_APPROVED_BRIDGED_TOOLS: ReadonlySet<string> = new Set(
  listBuiltinToolPolicies({ approval: 'auto' }).map(({ serverName, toolName }) =>
    buildDshCherryToolName(serverName, toolName)
  )
)

export const DSH_APPROVAL_REQUIRED_BRIDGED_TOOLS: ReadonlySet<string> = new Set(
  listBuiltinToolPolicies({ approval: 'required' }).map(({ serverName, toolName }) =>
    buildDshCherryToolName(serverName, toolName)
  )
)

export const DSH_NON_BYPASSABLE_APPROVAL_BRIDGED_TOOLS: ReadonlySet<string> = new Set(
  listBuiltinToolPolicies({ approval: 'required', bypassApproval: 'enforce' }).map(({ serverName, toolName }) =>
    buildDshCherryToolName(serverName, toolName)
  )
)

/** Warm user-configured catalogs before the connection snapshot captures their tool schemas. */
export async function warmDshMcpToolCatalogs(mcpIds: readonly string[]): Promise<void> {
  const catalog = application.get('McpCatalogService')
  const serverIds = new Set<string>()
  for (const idOrName of mcpIds) {
    const server = mcpServerService.findByIdOrName(idOrName)
    if (!server) {
      logger.warn('Skipping unresolvable MCP server referenced by dsh agent', { idOrName })
      continue
    }
    serverIds.add(server.id)
  }
  await Promise.allSettled([...serverIds].map((serverId) => catalog.refreshTools(serverId)))
}

/** Adapt every runtime-neutral MCP server into host-dispatched dsh native tools. */
export async function buildDshCherryToolBridge(
  servers: Record<string, AgentMcpServer>,
  options: DshCherryToolBridgeOptions
): Promise<DshCherryToolBridge> {
  const clients: Client[] = []
  const tools: BridgeToolDescriptor[] = []
  const bindings = new Map<string, DshToolBinding>()

  for (const [serverId, server] of Object.entries(servers)) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: `cherry-dsh-${serverId}`, version: '1.0.0' }, { capabilities: {} })
    try {
      await server.instance.connect(serverTransport)
      await client.connect(clientTransport)
      const result = await client.listTools()
      const serverNames = new Set<string>()
      const serverTools = result.tools.map((tool) => ({
        descriptor: toBridgeDescriptor(server.name, tool),
        rawName: tool.name
      }))
      for (const { descriptor } of serverTools) {
        if (bindings.has(descriptor.name) || serverNames.has(descriptor.name)) {
          throw new DshCherryToolIdentityError(`Duplicate dsh Cherry tool name: ${descriptor.name}`)
        }
        serverNames.add(descriptor.name)
      }
      clients.push(client)
      for (const { descriptor, rawName } of serverTools) {
        tools.push(descriptor)
        bindings.set(descriptor.name, { client, rawName })
      }
    } catch (error) {
      await client.close().catch(() => undefined)
      if (error instanceof DshCherryToolIdentityError) {
        await Promise.allSettled(clients.map((connected) => connected.close()))
        throw error
      }
      logger.warn('Skipping unavailable MCP server for dsh session', { serverId, error })
    }
  }

  return {
    tools,
    async callTool(name, args, signal) {
      const binding = bindings.get(name)
      if (!binding) throw new Error(`Unknown dsh Cherry tool: ${name}`)
      const result = (await binding.client.callTool(
        { name: binding.rawName, arguments: toToolArguments(args) },
        undefined,
        signal ? { signal } : undefined
      )) as CallToolResult
      if (result.isError) throw new Error(dshToolResultErrorText(result.content, binding.rawName))
      const text = await projectDshToolResult(result.content, binding.rawName, {
        ...options,
        ...(signal ? { signal } : {})
      })
      return { text, ...(result.structuredContent === undefined ? {} : { data: result.structuredContent }) }
    },
    async close() {
      await Promise.allSettled(clients.map((client) => client.close()))
    }
  }
}

function toBridgeDescriptor(serverName: string, tool: Tool): BridgeToolDescriptor {
  return {
    name: buildDshCherryToolName(serverName, tool.name),
    description: tool.description ?? '',
    inputSchema: tool.inputSchema as Record<string, unknown>
  }
}

function toToolArguments(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
}
