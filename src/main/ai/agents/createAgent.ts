import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

import { createAgentDataDirectory, removeAgentDataDirectory } from './agentDataDirectory'
import { repairHeartbeatSchedules, syncHeartbeatSchedule } from './heartbeatSchedule'

const logger = loggerService.withContext('CreateAgent')

export async function createAgent(request: CreateAgentCommand) {
  const agentId = uuidv4()
  const agentsDataRoot = application.getPath('feature.agents.data')
  await createAgentDataDirectory(agentsDataRoot, agentId)

  try {
    const agent = agentService.createAgentWithId(agentId, request)
    // Await so a transient failure cannot leave the agent heartbeat-less until
    // the next restart; failure stays non-fatal (v1 contract), with one eager retry.
    try {
      await syncHeartbeatSchedule(agent.id)
    } catch (error) {
      logger.warn('Failed to provision heartbeat schedule for new agent', { agentId, error })
      void repairHeartbeatSchedules().catch((repairError) => {
        logger.warn('Heartbeat schedule re-repair failed after agent creation', { agentId, repairError })
      })
    }
    return agent
  } catch (error) {
    try {
      await removeAgentDataDirectory(agentsDataRoot, agentId)
    } catch (cleanupError) {
      logger.warn('Failed to roll back agent data directory after database create failure', {
        agentId,
        cleanupError
      })
    }
    throw error
  }
}
