/**
 * MCP catalog inputs for a Claude Code session build: SDK server specs, tool display metadata
 * (with the alias forms the CLI may use to name a tool), and the bounded tools-cache warm that
 * keeps a cold or dead server from stalling session start (issue #16242).
 */

import type { McpServerConfig } from '@anthropic-ai/claude-agent-sdk'
import { application } from '@application'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import {
  buildAgentMcpServers,
  type LinkedChannelSnapshot,
  type McpServerSnapshotMap
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
  selectedKnowledgeBaseIds: readonly string[] = []
): Record<string, McpServerConfig> | undefined {
  const servers = buildAgentMcpServers(
    session,
    agent,
    mountedServers,
    mcpServerSnapshots,
    linkedChannelSnapshot,
    agentDataPath,
    selectedKnowledgeBaseIds
  )
  return Object.fromEntries(
    Object.entries(servers).map(([id, server]) => [id, { type: 'sdk', ...server } satisfies McpServerConfig])
  )
}

function addMcpToolMetadataAlias(
  metadataByName: Record<string, McpToolDisplayMetadata>,
  key: string | undefined,
  metadata: McpToolDisplayMetadata
): void {
  if (!key) return
  metadataByName[key] = metadata
}

function addMcpToolMetadataAliases(
  metadataByName: Record<string, McpToolDisplayMetadata>,
  server: McpServer,
  tool: McpTool
): void {
  const metadata: McpToolDisplayMetadata = {
    type: 'mcp',
    serverId: server.id,
    serverName: server.name,
    name: tool.name,
    description: tool.description
  }

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

export async function buildMcpToolMetadata(
  agent: AgentEntity
): Promise<Record<string, McpToolDisplayMetadata> | undefined> {
  const mcpIds = agent.mcps
  if (!mcpIds?.length) return undefined

  const metadataByName: Record<string, McpToolDisplayMetadata> = {}
  const mcpService = application.get('McpCatalogService')

  for (const mcpId of mcpIds) {
    try {
      const server = mcpServerService.findByIdOrName(mcpId)
      if (!server) continue

      const tools = mcpService.listTools(server.id)
      for (const tool of tools) {
        addMcpToolMetadataAliases(metadataByName, server, tool)
      }
    } catch (error) {
      logger.warn('Failed to build MCP tool display metadata', { mcpId, error })
    }
  }

  return Object.keys(metadataByName).length > 0 ? metadataByName : undefined
}
