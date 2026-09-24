import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { prepareAgentSessionWorkspaceDirectory } from '@main/ai/runtime/agentSessionWorkspace'
import type { Tool } from '@shared/ai/tool'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import type { AgentRuntimeConnectInput, AgentRuntimeConnection, AgentSessionRuntimeDriver } from '../types'
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

  listAvailableTools(_mcpIds: string[]): Promise<Tool[]> {
    return Promise.resolve([])
  }

  async connect(input: AgentRuntimeConnectInput): Promise<AgentRuntimeConnection> {
    const session = agentSessionService.getById(input.sessionId)
    await this.validateSession(session)
    return new UarRuntimeConnection(input).start()
  }
}
