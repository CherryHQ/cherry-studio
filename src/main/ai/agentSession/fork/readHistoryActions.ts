import { agentService } from '@data/services/AgentService'
import { agentSessionForkService } from '@data/services/AgentSessionForkService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { forkCheckpointReader } from '@main/ai/runtime/registry'

import { getEditFailure, inspectForkBoundary } from './historyActions'

export function readHistoryActions(sessionId: string, messageIds: readonly string[]) {
  const session = agentSessionService.getById(sessionId)
  const agent = session.agentId ? agentService.getAgent(session.agentId) : undefined
  const reader = agent ? forkCheckpointReader(agent.type) : undefined
  return new Map(
    agentSessionForkService
      .readHistoryBoundaries(sessionId, messageIds)
      .map((row) => [
        row.id,
        { fork: inspectForkBoundary(reader, row).reason, edit: getEditFailure(reader, row, row.parent) }
      ])
  )
}
