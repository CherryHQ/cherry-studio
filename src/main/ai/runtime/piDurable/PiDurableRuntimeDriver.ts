import { agentService } from '@data/services/AgentService'
import { PI_TOOL_RECALL_TOOL_NAME } from '@shared/ai/piBuiltinTools'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import { listPiAvailableTools } from '../pi/PiRuntimeDriver'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from '../types'
import { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'

export class PiDurableRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi-durable'
  readonly messageSource = 'projection' as const
  readonly capabilities = ['agent-session'] as const

  async validateSession(session: AgentSessionEntity): Promise<void> {
    if (!session.agentId || !session.workspace.path || !agentService.getAgent(session.agentId)?.model)
      throw new Error('Pi Durable requires an agent, workspace and model')
    await prepareAgentSessionWorkspaceDirectory(session)
  }

  async listAvailableTools(mcpIds: string[]) {
    return (await listPiAvailableTools(mcpIds)).filter((tool) => tool.id !== PI_TOOL_RECALL_TOOL_NAME)
  }

  connect(input: AgentRuntimeConnectInput) {
    return new PiDurableRuntimeConnection(input).start()
  }
}
