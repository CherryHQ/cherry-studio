/**
 * MCP catalog inputs for a Claude Code session build: SDK server specs, tool display metadata
 * (with the alias forms the CLI may use to name a tool), and the bounded tools-cache warm that
 * keeps a cold or dead server from stalling session start (issue #16242).
 */

import type { McpSdkServerConfigWithInstance, McpServerConfig } from '@anthropic-ai/claude-agent-sdk'

import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import {
  type AgentNotificationContext,
  buildAgentMcpServers,
  type LinkedChannelSnapshot,
  type McpServerSnapshotMap,
  resolveMountedAgentMcpServers
} from '@main/ai/runtime/agentMcpServers'
import { toCamelCase } from '@shared/ai/tools/mcpToolName'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { McpServer } from '@shared/data/types/mcpServer'
import type { McpTool } from '@shared/types/mcp'

import type { McpToolDisplayMetadata } from './types'

const logger = loggerService.withContext('ClaudeCodeMcpCatalog')

export function buildMcpServers(
  session: AgentSessionEntity,
  agent: AgentEntity,
  mountedServers: ReadonlySet<string>,
  mcpServerSnapshots?: McpServerSnapshotMap,
  linkedChannelSnapshot?: LinkedChannelSnapshot,
  agentDataPath = session.workspace.path,
  selectedKnowledgeBaseIds: readonly string[] = [],
  notificationContext?: AgentNotificationContext
): Record<string, McpServerConfig> | undefined {
  const servers = buildAgentMcpServers(
    session,
    agent,
    mountedServers,
    mcpServerSnapshots,
    linkedChannelSnapshot,
    agentDataPath,
    selectedKnowledgeBaseIds,
    notificationContext
  )

  return Object.fromEntries(
    Object.entries(servers).map(([id, { name, connect }]) => [
      id,
      {
        type: 'sdk',
        name,
        // The SDK only calls `connect` on its own 2025-era transport; v2 serves that era.
        instance: { connect } as unknown as McpSdkServerConfigWithInstance['instance']
      } satisfies McpServerConfig
    ])
  )
}

function addMcpToolMetadataAlias(
  metadataByName: Record<string, McpToolDisplayMetadata>,
  key: string | undefined,
  metadata: McpToolDisplayMetadata
): void {
  // First claim wins: the runtime-key pass runs before the compatibility aliases, and no
  // alias may overwrite it (two servers can share a configured name; only one registers
  // under it).
  if (!key || Object.hasOwn(metadataByName, key)) return
  metadataByName[key] = metadata
}

function toMcpToolMetadata(server: McpServer, tool: McpTool): McpToolDisplayMetadata {
  return {
    type: 'mcp',
    serverId: server.id,
    serverName: server.name,
    name: tool.name,
    description: tool.description
  }
}

/**
 * Compatibility aliases the CLI may use to name a tool (catalog id, uuid-keyed forms, raw and
 * camelized configured-name forms). Never overwrite: the authoritative runtime-key entries are
 * written first and a same-named server's aliases must not steal its identity.
 */
function addMcpToolMetadataAliases(
  metadataByName: Record<string, McpToolDisplayMetadata>,
  server: McpServer,
  tool: McpTool
): void {
  const metadata = toMcpToolMetadata(server, tool)

  addMcpToolMetadataAlias(metadataByName, tool.id, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${server.id}__${tool.name}`, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${server.id}__${toCamelCase(tool.name)}`, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${server.name}__${tool.name}`, metadata)
  addMcpToolMetadataAlias(metadataByName, `mcp__${toCamelCase(server.name)}__${tool.name}`, metadata)
}

// Session build reads MCP tools from cache-only `listTools` (sync, so a dead server can't stall
// startup — issue #16242). The approval descriptors + tool-card metadata built below therefore
// see nothing for a server whose cache is still cold on a first session. Warm the agent's own
// servers via the single-flighted `warmToolsCache` so fast cache hits can contribute configured
// tools — bounded by a short cache-hit window so a dead/slow server still can't stall session
// start; on timeout we fall back to the empty cache. The in-flight refresh keeps running past the cap and
// then converges BOTH remaining consumers: the caller chains a reconciliation onto `warm` (step 7
// of the build) that rebuilds the session snapshot + metadata, and the cache write it lands fires
// `onToolsCacheUpdated`, which the SDK bridge relays as `tools/list_changed` so the SDK re-lists.
// The warm also carries a liveness duty beyond latency: it is the only path that re-probes a
// warmed-but-empty cache after its retry window (see `warmToolsCache`), letting a previously-dead
// server recover without reconnecting it on every session build.
const MCP_WARM_TIMEOUT_MS = 100

export interface McpWarmResult {
  // False when the bounded race hit the cap with the refresh still in flight.
  completedInTime: boolean
  // The underlying single-flighted refresh; keeps running past the cap.
  warm: Promise<unknown>
}

export async function warmAgentMcpToolCaches(agent: AgentEntity): Promise<McpWarmResult> {
  const mcpIds = agent.mcps
  if (!mcpIds?.length) return { completedInTime: true, warm: Promise.resolve() }

  const mcpService = application.get('McpCatalogService')
  const warm = Promise.allSettled(
    mcpIds.flatMap((mcpId) => {
      const server = mcpServerService.findByIdOrName(mcpId)
      return server ? [mcpService.warmToolsCache(server.id)] : []
    })
  )

  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), MCP_WARM_TIMEOUT_MS)
    timer.unref?.()
  })

  const completedInTime = await Promise.race([warm.then(() => true), timeout])
  if (timer) clearTimeout(timer)
  return { completedInTime, warm }
}

export interface McpToolMetadataOptions {
  /**
   * The running connection's server allocation (mounted id or name → runtime record key, as
   * captured at session build). Metadata must attribute tools under the keys the LIVE
   * connection registered: until a deferred rebuild replaces the connection, re-allocating
   * from the current agent.mcps hands a removed server's configured-name key to a same-named
   * survivor the connection still binds under its own key.
   */
  serverAllocation?: ReadonlyMap<string, string>
}

export async function buildMcpToolMetadata(
  agent: AgentEntity,
  options?: McpToolMetadataOptions
): Promise<Record<string, McpToolDisplayMetadata> | undefined> {
  const allocation = options?.serverAllocation
  if (!agent.mcps?.length && !allocation?.size) return undefined

  const mcpService = application.get('McpCatalogService')
  // Same allocation the record builder uses: the key a server registers under is the only
  // authority for which metadata a runtime tool name (`mcp__<key>__<tool>`) resolves to. With a
  // frozen allocation the mounted set comes from the map itself — servers since unmounted stay
  // attributed until the connection is replaced.
  const mountedEntries: Array<{ mcpId: string; key: string }> = allocation?.size
    ? [...allocation].map(([mcpId, key]) => ({ mcpId, key }))
    : resolveMountedAgentMcpServers(agent).map(({ mcpId, key }) => ({ mcpId, key }))
  const mounted = mountedEntries.flatMap(({ mcpId, key }) => {
    try {
      const server = mcpServerService.findByIdOrName(mcpId)
      if (!server) return []
      return [{ server, key, tools: mcpService.listTools(server.id) }]
    } catch (error) {
      logger.warn('Failed to build MCP tool display metadata', { mcpId, error })
      return []
    }
  })

  const metadataByName: Record<string, McpToolDisplayMetadata> = {}
  // Exact runtime names claim first: every tool gets its own `mcp__<key>__<tool>` entry
  // before any alias exists, so one tool's camelized alias can never take another tool's
  // exact name (`search_docs` + `searchDocs` on one server).
  for (const { server, key, tools } of mounted) {
    for (const tool of tools) {
      addMcpToolMetadataAlias(metadataByName, `mcp__${key}__${tool.name}`, toMcpToolMetadata(server, tool))
    }
  }
  // Compatibility aliases: camelized key forms, catalog id, uuid forms, raw/camel name forms.
  // First claim wins, so no alias can overwrite an exact entry or another server's identity.
  for (const { server, key, tools } of mounted) {
    for (const tool of tools) {
      const metadata = toMcpToolMetadata(server, tool)
      addMcpToolMetadataAlias(metadataByName, `mcp__${key}__${toCamelCase(tool.name)}`, metadata)
      addMcpToolMetadataAliases(metadataByName, server, tool)
    }
  }

  return Object.keys(metadataByName).length > 0 ? metadataByName : undefined
}
