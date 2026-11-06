import { agentService } from '@data/services/AgentService'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'

import { prepareAgentSessionWorkspaceDirectory } from '../agentSessionWorkspace'
import type { AgentRuntimeConnectInput, AgentSessionRuntimeDriver } from '../types'
import { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'

export class PiDurableRuntimeDriver implements AgentSessionRuntimeDriver {
  readonly type = 'pi-durable'

  async validateSession(session: AgentSessionEntity): Promise<void> {
    if (!session.agentId || !session.workspace.path || !agentService.getAgent(session.agentId)?.model)
      throw new Error('Pi Durable requires an agent, workspace and model')
    await prepareAgentSessionWorkspaceDirectory(session)
  }

  connect(input: AgentRuntimeConnectInput) {
    return new PiDurableRuntimeConnection(input).start()
  }
}
