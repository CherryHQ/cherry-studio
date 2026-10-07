import { pathToFileURL } from 'node:url'

import type { McpServer as LegacyMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { loggerService } from '@logger'
import { resolveAgentCapabilities, resolveHostTools } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import AgentMemoryMcpServer from '@main/ai/mcp/servers/agentMemory'
import AssistantMcpServer from '@main/ai/mcp/servers/assistant'
import { AssistantFileToolsServer } from '@main/ai/mcp/servers/AssistantFileToolsServer'
import CherryBuiltinMcpServer from '@main/ai/mcp/servers/cherryBuiltinTools'
import McpManagerServer from '@main/ai/mcp/servers/mcpManager'
import SkillsMcpServer from '@main/ai/mcp/servers/skills'
import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'
import { BuiltinMcpServerNames, isInMemoryBuiltinMcpServer } from '@shared/utils/mcp'

import type { AgentMcpServer } from './agentMcpServer'

const logger = loggerService.withContext('AgentMcpServers')

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

// TODO(mcp-v2): remove once every agent server is a v2 McpServer.
function serveLegacyAgentMcpServer(instance: LegacyMcpServer): AgentMcpServer['connect'] {
  return (transport) => instance.connect(transport)
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
      const bridge = createMcpBridgeServer(mcpId, serverSnapshot, { interactionContext })
      servers[mcpId] = { id: legacyServer?.id, name: mcpId, connect: serveLegacyAgentMcpServer(bridge) }
    } catch (error) {
      logger.error(`Failed to create MCP bridge for ${mcpId}`, { error })
    }
  }

  if (mountedServers.has(CHERRY_MCP_SERVER.BROWSER)) {
    servers.browser = {
      name: CHERRY_MCP_SERVER.BROWSER,
      connect: serveLegacyAgentMcpServer(
        application.get('BrowserSessionService').createAgentMcpServer({ agentId: agent.id, sessionId: session.id })
      )
    }
  }

  const workspaceSource = toWorkspaceSource(session)
  servers['cherry-tools'] = {
    name: CHERRY_MCP_SERVER.CHERRY_TOOLS,
    connect: serveLegacyAgentMcpServer(
      new CherryBuiltinMcpServer({
        agentId: agent.id,
        agentDataPath,
        sessionId: session.id,
        workspaceSource,
        workspacePath: session.workspace.path,
        trustedNotifyChannels: notificationContext.channels,
        allowAnyOwnedNotifyChannel: notificationContext.allowAnyOwnedChannel,
        canAccessAllKnowledgeBases: () => resolveAgentCapabilities(agentService.getAgent(agent.id)).allKnowledgeBases,
        getKnowledgeBaseIds: () => {
          const liveAgent = agentService.getAgent(agent.id)
          return liveAgent ? resolveKnowledgeBaseScope(liveAgent.knowledgeBaseIds, selectedKnowledgeBaseIds) : []
        }
      }).mcpServer
    )
  }
  servers['agent-memory'] = {
    name: CHERRY_MCP_SERVER.AGENT_MEMORY,
    connect: serveLegacyAgentMcpServer(new AgentMemoryMcpServer(agent.id, agentDataPath).mcpServer)
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.SKILLS)) {
    servers.skills = {
      name: CHERRY_MCP_SERVER.SKILLS,
      connect: serveLegacyAgentMcpServer(new SkillsMcpServer(agent.id).mcpServer)
    }
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.MCP_MANAGER)) {
    servers['mcp-manager'] = {
      name: CHERRY_MCP_SERVER.MCP_MANAGER,
      connect: serveLegacyAgentMcpServer(new McpManagerServer(agent.id).mcpServer)
    }
  }

  if (mountedServers.has(CHERRY_MCP_SERVER.ASSISTANT)) {
    servers.assistant = {
      name: CHERRY_MCP_SERVER.ASSISTANT,
      connect: serveLegacyAgentMcpServer(new AssistantMcpServer(agent.model ?? undefined, hostTools?.tools).mcpServer)
    }
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.ASSISTANT_FILES)) {
    servers['assistant-files'] = {
      name: CHERRY_MCP_SERVER.ASSISTANT_FILES,
      connect: serveLegacyAgentMcpServer(
        new AssistantFileToolsServer({
          sessionId: session.id,
          workspacePath: session.workspace.path
        }).mcpServer
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
