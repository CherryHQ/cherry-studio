import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { mcpServerService } from '@data/services/McpServerService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
import { toUarToolName } from './UarAguiAdapter'
import { UarRuntimeConnection } from './UarRuntimeConnection'

export class UarRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'uar'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    if (!session.agentId) throw new Error(`UAR session ${session.id} has no agent`)
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) throw new Error(`UAR agent ${session.agentId} has no model configured`)
    await prepareAgentSessionWorkspaceDirectory(session)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const builtins: Tool[] = listBuiltinToolPolicies().map((tool) => ({
      id: toUarToolName(`mcp__${tool.serverName}__${tool.toolName}`),
      name: tool.toolName,
      origin: 'builtin',
      approval: tool.approval === 'auto' ? 'auto' : 'prompt',
      sourceId: tool.serverName,
      sourceName: tool.serverName
    }))
    const catalog = application.get('McpCatalogService')
    const mcpTools: Tool[] = mcpIds.flatMap((idOrName) => {
      const server = mcpServerService.findByIdOrName(idOrName)
      if (!server) return []
      return catalog.listTools(server.id, { includeDisabled: false }).map((tool) => ({
        id: toUarToolName(`${idOrName}__${tool.name}`),
        name: tool.name,
        description: tool.description,
        origin: 'mcp' as const,
        approval: 'prompt' as const,
        sourceId: server.id,
        sourceName: server.name
      }))
    })
    return [...builtins, ...mcpTools]
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const session = agentSessionService.getById(input.sessionId)
    await this.validateSession(session)
    return new UarRuntimeConnection(input).start()
  }
}
