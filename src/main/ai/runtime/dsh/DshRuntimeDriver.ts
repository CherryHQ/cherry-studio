import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import { DSH_BUILTIN_TOOLS } from '@shared/ai/dshBuiltinTools'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
import { buildDshCherryToolName, DSH_AUTO_APPROVED_BRIDGED_TOOLS } from './DshCherryToolBridge'
import { DshRuntimeConnection } from './DshRuntimeConnection'
import { assertDshProviderUsable } from './modelInjection'

export class DshRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'dsh'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`dsh agent session ${session.id} has no workspace configured`)
    }
    if (!session.agentId) {
      throw new Error(`dsh agent session ${session.id} has no agent`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`dsh agent ${session.agentId} has no model configured`)
    }
    await prepareAgentSessionWorkspaceDirectory(session)
    // Side-effect free: dispatch validation must not consume API-key rotation;
    // the concrete key is selected only when the runtime connection starts.
    await assertDshProviderUsable(agent.model)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const builtins: Tool[] = DSH_BUILTIN_TOOLS.map((tool) => ({
      id: tool.name,
      name: tool.name,
      origin: 'builtin',
      approval: tool.approval
    }))
    // Host-bridged MCP tools, read cache-only from the same catalog the session bridge uses.
    const catalog = application.get('McpCatalogService')
    const mcpTools: Tool[] = mcpIds.flatMap((idOrName) => {
      const server = mcpServerService.findByIdOrName(idOrName)
      if (!server) return []
      return catalog.listTools(server.id, { includeDisabled: false }).map((tool) => {
        const id = buildDshCherryToolName(server.name, tool.name)
        return {
          id,
          name: tool.name,
          origin: 'mcp' as const,
          approval: DSH_AUTO_APPROVED_BRIDGED_TOOLS.has(id) ? ('auto' as const) : ('prompt' as const),
          sourceId: server.id,
          sourceName: server.name
        }
      })
    })
    return [...builtins, ...mcpTools]
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new DshRuntimeConnection(input).start()
  }
}
