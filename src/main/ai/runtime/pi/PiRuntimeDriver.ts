import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { Tool } from '@shared/ai/tool'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
import { assertPiProviderUsable } from './modelInjection'
import { PiRuntimeConnection } from './PiRuntimeConnection'

export class PiRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`pi agent session ${session.id} has no workspace configured`)
    }
    if (!session.agentId) {
      throw new Error(`pi agent session ${session.id} has no agent`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`pi agent ${session.agentId} has no model configured`)
    }
    // Side-effect free: dispatch validation must not consume API-key rotation;
    // the concrete key is selected only when the runtime connection starts.
    await assertPiProviderUsable(agent.model)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const builtins: Tool[] = PI_BUILTIN_TOOLS.map((tool) => ({
      id: tool.name,
      name: tool.name,
      origin: 'builtin',
      approval: tool.approval
    }))
    // Bridged MCP tools, read cache-only from the same catalog the session bridge uses
    // (piMcpToolAdapter warms it). Third-party, so they prompt in the default mode.
    const catalog = application.get('McpCatalogService')
    const mcpTools: Tool[] = mcpIds.flatMap((idOrName) => {
      const server = mcpServerService.findByIdOrName(idOrName)
      if (!server) return []
      return catalog.listTools(server.id, { includeDisabled: false }).map((tool) => ({
        id: buildFunctionCallToolName(server.name, tool.name),
        name: tool.name,
        origin: 'mcp' as const,
        approval: 'prompt' as const,
        sourceId: server.id,
        sourceName: server.name
      }))
    })
    return [...builtins, ...mcpTools]
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new PiRuntimeConnection(input).start()
  }
}
