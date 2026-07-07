import { agentService } from '@data/services/AgentService'
import { PI_BUILTIN_TOOLS } from '@shared/ai/piBuiltinTools'
import type { Tool } from '@shared/ai/tool'
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

  async listAvailableTools(_mcpIds: string[]): Promise<Tool[]> {
    // MCP is deferred for pi v1 (plan capability matrix); mcpIds are ignored.
    return PI_BUILTIN_TOOLS.map((tool) => ({
      id: tool.name,
      name: tool.name,
      origin: 'builtin',
      approval: tool.approval
    }))
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    return new PiRuntimeConnection(input).start()
  }
}
