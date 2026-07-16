import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { AI_SDK_AGENT_BUILTIN_TOOLS } from '@shared/ai/aiSdkAgentBuiltinTools'
import type { Tool } from '@shared/ai/tool'
import { buildFunctionCallToolName } from '@shared/ai/tools/mcpToolName'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
import { AiSdkRuntimeConnection } from './AiSdkRuntimeConnection'
import { resolveAndAssertAiSdkAgentModel } from './validateModel'

export class AiSdkRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'ai-sdk'
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    const cwd = session.workspace?.path
    if (!cwd) {
      throw new Error(`ai-sdk agent session ${session.id} has no workspace configured`)
    }
    if (!session.agentId) {
      throw new Error(`ai-sdk agent session ${session.id} has no agent`)
    }
    const agent = agentService.getAgent(session.agentId)
    if (!agent?.model) {
      throw new Error(`ai-sdk agent ${session.agentId} has no model configured`)
    }
    // Side-effect free: dispatch validation must not consume API-key rotation;
    // the concrete key is selected only when a turn's params are built.
    resolveAndAssertAiSdkAgentModel(agent.model)
  }

  async listAvailableTools(mcpIds: string[]): Promise<Tool[]> {
    const builtins: Tool[] = AI_SDK_AGENT_BUILTIN_TOOLS.map((tool) => ({
      id: tool.name,
      name: tool.name,
      origin: 'builtin',
      approval: tool.approval
    }))
    // Selected MCP tools, read cache-only from the same catalog the runtime's
    // tool phase resolves through. Third-party, so they prompt in the default mode.
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
    return new AiSdkRuntimeConnection(input).start()
  }
}
