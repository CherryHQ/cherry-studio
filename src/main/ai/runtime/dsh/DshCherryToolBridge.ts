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
   * Denial-rule string → the runtime name(s) this bridge registered for it. Keys: the
   * name-form rule `mcp__<server name>__<raw tool>` (two pairs can flatten to one string —
   * their candidates merge, fail-closed), the exact pair identity `<server name>\0<raw tool>`,
   * the allocated runtime names themselves (a denial saved at runtime is the registered name,
   * which another pair's name-form rule can flatten onto), each identity's historical
   * collision-allocated name (a deterministic pair hash) and its allocator collision base (the
   * plain name truncated to 50 — any counter depth strips to it after a reconnect), and
   * pre-name runtime aliases rebuilt from mounted-server ids (wire-safe and hashed forms) so
   * denials saved under uuid-keyed names follow the server to its current identity.
   */
  readonly ruleNames: ReadonlyMap<string, readonly string[]>
  callTool(name: string, args: unknown, signal?: AbortSignal): Promise<BridgeToolCallResult>
  close(): Promise<void>
}

export interface DshCherryToolBridgeOptions {
  agentsDataRoot: string
  toolResultRoot: string
  /**
   * Mounted-server id → runtime record key. Aliases of every known id are rebuilt so a denial
   * saved while tools were keyed by that id (`mcp__<id>__<tool>`, lossy-hashed when long)
   * translates onto the name the bridge allocated under the configured server name.
   */
  serverNameById?: ReadonlyMap<string, string>
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
  const identities: Array<{ serverKey: string; rawTool: string; runtimeName: string }> = []

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
        identities.push({ serverKey: server.name, rawTool: raw.name, runtimeName: name })
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
    ruleNames: buildDshCherryRuleNameLookup(identities, options.serverNameById),
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
function pairCollisionName(serverName: string, toolName: string): string {
  const base = buildDshCherryToolName(serverName, toolName).slice(0, 50)
  return `${base}_${createHash('sha256').update(`${serverName}\0${toolName}`).digest('hex').slice(0, 12)}`
}

function disambiguatedDshToolName(serverName: string, toolName: string, taken: ReadonlySet<string>): string {
  const base = buildDshCherryToolName(serverName, toolName).slice(0, 50)
  let name = pairCollisionName(serverName, toolName)
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

/**
 * Index the registered identities for denial-rule translation. A flattened name-form string that
 * two pairs share maps to every candidate (over-blocking beats letting an explicitly disabled
 * tool execute); the `\0`-joined pair identity (never a valid `mcp__` string) stays exact for
 * id-keyed rules; and each known mounted-server id rebuilds the name tools carried before
 * configured-name registration so old denials follow their server.
 */
function buildDshCherryRuleNameLookup(
  identities: ReadonlyArray<{ serverKey: string; rawTool: string; runtimeName: string }>,
  serverNameById: ReadonlyMap<string, string> = new Map()
): ReadonlyMap<string, readonly string[]> {
  const ruleNames = new Map<string, readonly string[]>()
  const addRule = (rule: string, runtimeName: string) => {
    const existing = ruleNames.get(rule)
    if (existing) {
      if (!existing.includes(runtimeName)) ruleNames.set(rule, [...existing, runtimeName])
    } else {
      ruleNames.set(rule, [runtimeName])
    }
  }
  const rawToolsByKey = new Map<string, Array<{ rawTool: string; runtimeName: string }>>()
  for (const { serverKey, rawTool, runtimeName } of identities) {
    addRule(`mcp__${serverKey}__${rawTool}`, runtimeName)
    addRule(`${serverKey}\u0000${rawTool}`, runtimeName)
    // The registered runtime name itself is a saved denial string: a user disabling a tool at
    // runtime writes exactly this string. Another pair's name-form rule can flatten onto it
    // (B `oldServer`/`run_4f7413c24ae4` vs A `Old server`/`run`), so the runtime identity must
    // claim its own name too — otherwise translation rewrites A's denial onto B's allocation
    // and the exact-match policy lets the explicitly disabled tool execute.
    addRule(runtimeName, runtimeName)
    // A denial can also be saved under this pair's collision-allocated name from an earlier
    // topology whose colliding neighbor has since been unmounted: the survivor re-registers
    // under the plain name and the saved string matches nothing. The disambiguator is a
    // deterministic hash of the pair, so the historical name is reconstructible and follows
    // the pair to its current identity.
    const historical = pairCollisionName(serverKey, rawTool)
    if (historical !== runtimeName) addRule(historical, runtimeName)
    // Deeper counter allocations (`base + hash(pair\0counter)`, for any counter depth) strip to
    // this base when the disambiguator suffix is removed — and a plain name longer than 50
    // chars truncates the base below any parseable form. Indexing the allocator's exact base
    // lets every stripped historical name resolve to the identity regardless of depth.
    addRule(buildDshCherryToolName(serverKey, rawTool).slice(0, 50), runtimeName)
    const siblings = rawToolsByKey.get(serverKey)
    if (siblings) siblings.push({ rawTool, runtimeName })
    else rawToolsByKey.set(serverKey, [{ rawTool, runtimeName }])
  }
  for (const [serverId, serverKey] of serverNameById) {
    for (const { rawTool, runtimeName } of rawToolsByKey.get(serverKey) ?? []) {
      addRule(buildDshCherryToolName(serverId, rawTool), runtimeName)
    }
  }
  return ruleNames
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
