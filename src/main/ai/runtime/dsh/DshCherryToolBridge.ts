import { createHash } from 'node:crypto'

import { Client, InMemoryTransport } from '@modelcontextprotocol/client'

import type { BridgeToolCallResult, BridgeToolDescriptor } from '@cherrystudio/dsh-bridge'
import { loggerService } from '@logger'
import { MCP_FORWARDING_TIMEOUT_MS } from '@main/ai/mcp/mcpRequestOptions'
import { mcpModelContent } from '@main/ai/mcp/toolResult'
import type { AgentMcpServer } from '@main/ai/runtime/agentMcpServers'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'

import { dshToolResultErrorText, projectDshToolResult } from './dshToolResultProjection'

const logger = loggerService.withContext('DshCherryToolBridge')

interface DshToolBinding {
  client: Client
  rawName: string
}

export interface DshCherryToolBridge {
  tools: BridgeToolDescriptor[]
  /**
   * `mcp__<server name>__<raw tool>` → the runtime name this bridge registered for the pair
   * (wire-safe plain or lossy hash identity). Policy layers map denial rules onto these
   * registered identities instead of re-deriving names.
   */
  readonly ruleNames: ReadonlyMap<string, string>
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

/** Upper bound on collision rehashes before a config is declared pathological. */
const DSH_TOOL_NAME_DISAMBIGUATION_LIMIT = 1000

/** Adapt every runtime-neutral MCP server into host-dispatched dsh native tools. */
export async function buildDshCherryToolBridge(
  servers: Record<string, AgentMcpServer>,
  options: DshCherryToolBridgeOptions
): Promise<DshCherryToolBridge> {
  const clients: Client[] = []
  const tools: BridgeToolDescriptor[] = []
  const bindings = new Map<string, DshToolBinding>()
  const usedNames = new Set<string>()
  const ruleNames = new Map<string, string>()

  for (const [serverId, server] of Object.entries(servers)) {
    let client: Client | undefined
    try {
      client = await connectClient(server, `cherry-dsh-${serverId}`)
      const result = await client.listTools()
      clients.push(client)
      for (const raw of result.tools) {
        // Two valid (server, tool) pairs can flatten to one wire name (`docs` + `search__all` vs
        // `docs__search` + `all`), and the first server to claim a name wins it. A stable hash
        // suffix keeps every tool callable — throwing here would fail the whole turn on a
        // configuration the name allocator accepts.
        let name = buildDshCherryToolName(server.name, raw.name)
        if (usedNames.has(name)) name = disambiguatedDshToolName(server.name, raw.name, usedNames)
        usedNames.add(name)
        ruleNames.set(`mcp__${server.name}__${raw.name}`, name)
        tools.push({
          name,
          description: raw.description ?? '',
          inputSchema: raw.inputSchema
        })
        bindings.set(name, { client, rawName: raw.name })
      }
    } catch (error) {
      await client?.close().catch(() => undefined)
      logger.warn('Skipping unavailable MCP server for dsh session', { serverId, error })
    }
  }

  return {
    tools,
    ruleNames,
    async callTool(name, args, signal) {
      const binding = bindings.get(name)
      if (!binding) throw new Error(`Unknown dsh Cherry tool: ${name}`)
      const result = await binding.client.callTool(
        { name: binding.rawName, arguments: toToolArguments(args) },
        // Forwarding only: no timeout policy at this layer — McpRuntimeService owns it (#20266).
        { signal, timeout: MCP_FORWARDING_TIMEOUT_MS }
      )
      const content = mcpModelContent(result)
      if (result.isError) throw new Error(dshToolResultErrorText(content, binding.rawName))
      const text = await projectDshToolResult(content, binding.rawName, {
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

/**
 * Collision identity for two (server, tool) pairs that flatten to the same wire name: the readable
 * prefix stays, and a fixed-width sha256 head of the raw pair keeps the extra name deterministic
 * (the same pair always resolves to the same identity) within the 63-char provider-safe cap.
 */
function disambiguatedDshToolName(serverName: string, toolName: string, taken: ReadonlySet<string>): string {
  const base = buildDshCherryToolName(serverName, toolName).slice(0, 50)
  let name = `${base}_${createHash('sha256').update(`${serverName}\0${toolName}`).digest('hex').slice(0, 12)}`
  // The counter must reach the retained suffix: re-hashing with it produces a fresh candidate,
  // and the bound turns a pathological config into a thrown error instead of a frozen main
  // process (a synchronous loop here blocks Electron startup).
  for (let counter = 1; counter <= DSH_TOOL_NAME_DISAMBIGUATION_LIMIT; counter++) {
    if (!taken.has(name)) return name
    name = `${base}_${createHash('sha256').update(`${serverName}\0${toolName}\0${counter}`).digest('hex').slice(0, 12)}`
  }
  throw new Error(
    `No free dsh tool name for ${serverName}/${toolName} after ${DSH_TOOL_NAME_DISAMBIGUATION_LIMIT} candidates`
  )
}

async function connectClient(server: AgentMcpServer, clientName: string): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: clientName, version: '1.0.0' })
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  return client
}

function toToolArguments(args: unknown): Record<string, unknown> {
  return typeof args === 'object' && args !== null && !Array.isArray(args) ? (args as Record<string, unknown>) : {}
}
