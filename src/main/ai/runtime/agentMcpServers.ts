import { application } from '@application'
import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import AgentMemoryServer from '@main/ai/mcp/servers/agentMemory'
import AssistantServer from '@main/ai/mcp/servers/assistant'
import { AssistantFileToolsServer } from '@main/ai/mcp/servers/AssistantFileToolsServer'
import CherryBuiltinToolsServer from '@main/ai/mcp/servers/cherryBuiltinTools'
import McpManagerServer from '@main/ai/mcp/servers/mcpManager'
import SkillsServer from '@main/ai/mcp/servers/skills'
import { CHERRY_MCP_SERVER } from '@main/ai/toolApproval/builtinToolPolicy'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'

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

export interface AgentMcpServer {
  name: string
  instance: McpServer
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
  const servers: Record<string, AgentMcpServer> = {}
  const capabilities = resolveAgentCapabilities(agent)

  for (const mcpId of agent.mcps ?? []) {
    try {
      const serverSnapshot = mcpServerSnapshots?.get(mcpId)
      if (mcpServerSnapshots && !serverSnapshot) {
        throw new Error(`MCP server not found in request snapshot: ${mcpId}`)
      }
      servers[mcpId] = { name: mcpId, instance: createMcpBridgeServer(mcpId, serverSnapshot) }
    } catch (error) {
      logger.error(`Failed to create MCP bridge for ${mcpId}`, { error })
    }
  }

  const workspaceSource = toWorkspaceSource(session)
  servers['cherry-tools'] = {
    name: CHERRY_MCP_SERVER.CHERRY_TOOLS,
    instance: new CherryBuiltinToolsServer({
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
  }
  servers['agent-memory'] = {
    name: CHERRY_MCP_SERVER.AGENT_MEMORY,
    instance: new AgentMemoryServer(agent.id, agentDataPath).mcpServer
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.SKILLS)) {
    servers.skills = { name: CHERRY_MCP_SERVER.SKILLS, instance: new SkillsServer(agent.id).mcpServer }
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.MCP_MANAGER)) {
    servers['mcp-manager'] = {
      name: CHERRY_MCP_SERVER.MCP_MANAGER,
      instance: new McpManagerServer(agent.id).mcpServer
    }
  }

  if (mountedServers.has(CHERRY_MCP_SERVER.ASSISTANT)) {
    servers.assistant = {
      name: CHERRY_MCP_SERVER.ASSISTANT,
      instance: new AssistantServer(agent.model ?? undefined, capabilities.hostTools?.tools).mcpServer
    }
  }
  if (mountedServers.has(CHERRY_MCP_SERVER.ASSISTANT_FILES)) {
    servers['assistant-files'] = {
      name: CHERRY_MCP_SERVER.ASSISTANT_FILES,
      instance: new AssistantFileToolsServer({
        sessionId: session.id,
        workspacePath: session.workspace.path
      }).mcpServer
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
