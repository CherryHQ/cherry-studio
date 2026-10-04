import { pathToFileURL } from 'node:url'

import type { McpServer, Server, Transport } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { resolveAgentCapabilities, resolveHostTools } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import { createAgentMemoryServer } from '@main/ai/mcp/servers/agentMemory'
import { createAssistantServer } from '@main/ai/mcp/servers/assistant'
import { createAssistantFileToolsServer } from '@main/ai/mcp/servers/AssistantFileToolsServer'
import { createCherryToolsServer } from '@main/ai/mcp/servers/cherryBuiltinTools'
import { createMcpManagerServer } from '@main/ai/mcp/servers/mcpManager'
import { createSkillsServer } from '@main/ai/mcp/servers/skills'
import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames, isInMemoryBuiltinMcpServer } from '@shared/utils/mcp'

const logger = loggerService.withContext('AgentMcpServers')

export interface AgentMcpServer {
  id?: string
  name: string
  /** Serves this server over `transport`; closing the transport ends it. */
  connect(transport: Transport): Promise<unknown>
}

/** One protocol instance per connection, so each runtime transport gets its own server. */
function serveAgentMcpServer(createServer: () => McpServer | Server): AgentMcpServer['connect'] {
  return async (transport) => serveStdio(createServer, { transport })
}

export type McpServerSnapshotMap = ReadonlyMap<string, McpServerEntity | undefined>
export type NotifyChannel = Pick<AgentChannelEntity, 'id' | 'type'>
export type LinkedChannelSnapshot = NotifyChannel | null

export interface AgentNotificationContext {
  /**
   * Never read directly — it is hashed into the connection rebuild signature so that binding or
   * unbinding a Session's channel rebuilds the connection (channel-linked sessions mount a
   * different MCP server set). Dropping it silently strands a session on the wrong tool surface.
   */
  sourceChannel: NotifyChannel | null
  channels: readonly NotifyChannel[]
  allowAnyOwnedChannel: boolean
}

/** Build the complete MCP server set exposed by an agent session, independent of runtime transport. */
export function buildAgentMcpServers(
  session: AgentSessionEntity,
  agent: AgentEntity,
  mountedServers: ReadonlySet<string>,
  mcpServerSnapshots?: McpServerSnapshotMap,
  linkedChannelSnapshot?: LinkedChannelSnapshot,
  agentDataPath = session.workspace.path,
  selectedKnowledgeBaseIds: readonly string[] = [],
  notificationContext = resolveAgentNotificationContext(session.id, agent.id, linkedChannelSnapshot)
): Record<string, AgentMcpServer> {
  const interactionContext = {
    sessionId: session.id,
    topicId: `agent-session:${session.id}`,
    model: agent.model ?? undefined,
    roots: [{ uri: pathToFileURL(session.workspace.path).toString(), name: session.workspace.name }]
  }
  const servers: Record<string, AgentMcpServer> = {}
  // Built-in entries are added after the user loop below; a user server must never take their keys.
  const takenServerNames = new Set<string>(Object.values(CHERRY_MCP_SERVER))
  const channelLinked =
    linkedChannelSnapshot === undefined ? notificationContext.sourceChannel !== null : linkedChannelSnapshot !== null
  const hostTools = resolveHostTools(agent, { channelLinked })

  for (const mcpId of agent.mcps ?? []) {
    try {
      const serverSnapshot = mcpServerSnapshots?.get(mcpId)
      const legacyServer = mcpServerSnapshots ? serverSnapshot : mcpServerService.findByIdOrName(mcpId)
      if (
        legacyServer &&
        isInMemoryBuiltinMcpServer(legacyServer) &&
        legacyServer.name === BuiltinMcpServerNames.browser
      )
        continue
      if (mcpServerSnapshots && !serverSnapshot) {
        throw new Error(`MCP server not found in request snapshot: ${mcpId}`)
      }
      if (!legacyServer) throw new Error(`MCP server not found: ${mcpId}`)
      // The SDK derives tool names (`mcp__<key>__<tool>`, 64-char cap) and routes tool calls from
      // the record key, so a 36-char UUID key leaves ~21 chars for the tool name and truncates the
      // rest into unreadable hashes (issue #21321). Register under the configured short name; fall
      // back to the id when the name is unknown or taken (`mcp_server.name` is not unique).
      const serverName = legacyServer.name && !takenServerNames.has(legacyServer.name) ? legacyServer.name : mcpId
      takenServerNames.add(serverName)
      servers[serverName] = {
        id: legacyServer.id,
        name: serverName,
        connect: serveAgentMcpServer(() => createMcpBridgeServer(mcpId, legacyServer, { interactionContext }))
      }
    } catch (error) {
      logger.error(`Failed to create MCP bridge for ${mcpId}`, { error })
    }
  }

  if (mountedServers.has(CHERRY_MCP_SERVER.BROWSER)) {
    servers.browser = {
      name: CHERRY_MCP_SERVER.BROWSER,
      connect: application
        .get('BrowserSessionService')
        .createAgentMcpServer({ agentId: agent.id, sessionId: session.id })
    }
  }

  const workspaceSource = toWorkspaceSource(session)
  servers['cherry-tools'] = {
    name: CHERRY_MCP_SERVER.CHERRY_TOOLS,
    connect: serveAgentMcpServer(() =>
      createCherryToolsServer({
        agentId: agent.id,
        agentDataPath,
        sessionId: session.id,
        workspaceSource,
        workspacePath: session.workspace.path,
        trustedNotifyChannels: notificationContext.channels,
        allowAnyOwnedNotifyChannel: notificationContext.allowAnyOwnedChannel,
        getKnowledgeAccess: () => {
          const liveAgent = agentService.getAgent(agent.id)
          return {
            allKnowledgeBases: resolveAgentCapabilities(liveAgent).allKnowledgeBases,
            baseIds: liveAgent ? resolveKnowledgeBaseScope(liveAgent.knowledgeBaseIds, selectedKnowledgeBaseIds) : []
          }
        }
      })
    )
  }
  servers['agent-memory'] = {
    name: CHERRY_MCP_SERVER.AGENT_MEMORY,
    connect: serveAgentMcpServer(() => createAgentMemoryServer({ agentId: agent.id, agentDataPath }))
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.SKILLS)) {
    servers.skills = {
      name: CHERRY_MCP_SERVER.SKILLS,
      connect: serveAgentMcpServer(() => createSkillsServer(agent.id))
    }
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.MCP_MANAGER)) {
    servers['mcp-manager'] = {
      name: CHERRY_MCP_SERVER.MCP_MANAGER,
      connect: serveAgentMcpServer(() => createMcpManagerServer(agent.id))
    }
  }

  if (mountedServers.has(CHERRY_MCP_SERVER.ASSISTANT)) {
    servers.assistant = {
      name: CHERRY_MCP_SERVER.ASSISTANT,
      connect: serveAgentMcpServer(() => createAssistantServer(agent.model ?? undefined, hostTools?.tools))
    }
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.ASSISTANT_FILES)) {
    servers['assistant-files'] = {
      name: CHERRY_MCP_SERVER.ASSISTANT_FILES,
      connect: serveAgentMcpServer(() =>
        createAssistantFileToolsServer({ sessionId: session.id, workspacePath: session.workspace.path })
      )
    }
  }

  return servers
}

function toWorkspaceSource(session: AgentSessionEntity): AgentSessionWorkspaceSource {
  switch (session.workspace.type) {
    case AGENT_WORKSPACE_TYPE.USER:
      return { type: AGENT_WORKSPACE_TYPE.USER, workspaceId: session.workspaceId }
    case AGENT_WORKSPACE_TYPE.SYSTEM:
      return { type: AGENT_WORKSPACE_TYPE.SYSTEM }
    default: {
      const exhaustive: never = session.workspace.type
      throw new Error(`Unsupported workspace type: ${String(exhaustive)}`)
    }
  }
}

export function resolveAgentNotificationContext(
  sessionId: string,
  agentId: string,
  linkedChannelSnapshot?: LinkedChannelSnapshot
): AgentNotificationContext {
  const sourceChannel =
    linkedChannelSnapshot === undefined ? resolveSourceChannelSafely(sessionId, agentId) : linkedChannelSnapshot
  const turnChannels = application.get('AgentSessionRuntimeService').getTurnTrustedNotifyChannels(sessionId)
  const channels = [...(turnChannels ?? (sourceChannel ? [sourceChannel] : []))].sort(
    (left, right) => left.id.localeCompare(right.id) || left.type.localeCompare(right.type)
  )

  return {
    sourceChannel,
    channels,
    allowAnyOwnedChannel: turnChannels === undefined && sourceChannel !== null
  }
}

/**
 * The Session's linked channel, or null unless it belongs to `agentId`. The ownership check is the
 * boundary that keeps one Agent's task output out of another's channel — never project without it.
 */
export function resolveLinkedNotifyChannel(sessionId: string, agentId: string): LinkedChannelSnapshot {
  const channel = channelService.findBySessionId(sessionId)
  return channel?.agentId === agentId ? { id: channel.id, type: channel.type } : null
}

function resolveSourceChannelSafely(sessionId: string, agentId: string): LinkedChannelSnapshot {
  try {
    return resolveLinkedNotifyChannel(sessionId, agentId)
  } catch {
    return null
  }
}

/**
 * Warm configured catalogs before a runtime snapshots their tool schemas. Single-flighted and
 * cache-respecting, so a warm cache costs nothing and a dead server waits out its retry backoff.
 */
export async function warmAgentMcpToolCatalogs(mcpIds: readonly string[]): Promise<void> {
  const catalog = application.get('McpCatalogService')
  await Promise.allSettled(
    mcpIds.flatMap((idOrName) => {
      const server = mcpServerService.findByIdOrName(idOrName)
      if (!server) logger.warn('Skipping unresolvable MCP server referenced by agent', { idOrName })
      return server ? [catalog.warmToolsCache(server.id)] : []
    })
  )
}
