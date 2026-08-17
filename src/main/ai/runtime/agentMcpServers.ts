import { agentChannelService as channelService } from '@data/services/AgentChannelService'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { createMcpBridgeServer } from '@main/ai/mcp/createMcpBridgeServer'
import AgentMemoryServer from '@main/ai/mcp/servers/agentMemory'
import AssistantServer, { SUPPORT_ASSISTANT_TOOL_NAMES } from '@main/ai/mcp/servers/assistant'
import { AssistantFileToolsServer } from '@main/ai/mcp/servers/AssistantFileToolsServer'
import CherryBuiltinToolsServer from '@main/ai/mcp/servers/cherryBuiltinTools'
import SkillsServer from '@main/ai/mcp/servers/skills'
import { resolveKnowledgeBaseScope } from '@main/ai/utils/knowledgeScope'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'
import type { AgentChannelEntity } from '@shared/data/api/schemas/agentChannels'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { McpServer as McpServerEntity } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('AgentMcpServers')

export type McpServerSnapshotMap = ReadonlyMap<string, McpServerEntity | undefined>
export type LinkedChannelSnapshot = Pick<AgentChannelEntity, 'id'> | null

export interface AgentMcpServer {
  name: string
  instance: McpServer
}

/** Build the complete MCP server set exposed by an agent session, independent of runtime transport. */
export function buildAgentMcpServers(
  session: AgentSessionEntity,
  agent: AgentEntity,
  assistantMcpEnabled: boolean,
  mcpServerSnapshots?: McpServerSnapshotMap,
  linkedChannelSnapshot?: LinkedChannelSnapshot,
  agentDataPath = session.workspace.path,
  selectedKnowledgeBaseIds: readonly string[] = []
): Record<string, AgentMcpServer> {
  const servers: Record<string, AgentMcpServer> = {}

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

  const sourceChannelId =
    linkedChannelSnapshot === undefined ? resolveSourceChannel(agent.id, session.id) : linkedChannelSnapshot?.id
  const workspaceSource = toWorkspaceSource(session)
  servers['cherry-tools'] = {
    name: 'cherry-tools',
    instance: new CherryBuiltinToolsServer({
      agentId: agent.id,
      agentDataPath,
      sessionId: session.id,
      workspaceSource,
      workspacePath: session.workspace.path,
      sourceChannelId,
      canAccessAllKnowledgeBases: () =>
        agentService.getAgent(agent.id)?.configuration?.builtin_role === BUILTIN_AGENT_ROLE.ASSISTANT,
      getKnowledgeBaseIds: () => {
        const liveAgent = agentService.getAgent(agent.id)
        return liveAgent ? resolveKnowledgeBaseScope(liveAgent.knowledgeBaseIds, selectedKnowledgeBaseIds) : []
      }
    }).mcpServer
  }
  servers['agent-memory'] = {
    name: 'agent-memory',
    instance: new AgentMemoryServer(agent.id, agentDataPath).mcpServer
  }
  if (agent.configuration?.builtin_role !== BUILTIN_AGENT_ROLE.SUPPORT) {
    servers.skills = { name: 'skills', instance: new SkillsServer(agent.id).mcpServer }
  }

  if (assistantMcpEnabled) {
    const assistantToolNames =
      agent.configuration?.builtin_role === BUILTIN_AGENT_ROLE.SUPPORT ? SUPPORT_ASSISTANT_TOOL_NAMES : undefined
    servers.assistant = {
      name: 'assistant',
      instance: new AssistantServer(agent.model ?? undefined, assistantToolNames).mcpServer
    }
    servers['assistant-files'] = {
      name: 'assistant-files',
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

function resolveSourceChannel(agentId: string, sessionId: string): string | undefined {
  try {
    return channelService.listChannels({ agentId }).find((channel) => channel.sessionId === sessionId)?.id
  } catch {
    return undefined
  }
}
