import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import { v4 as uuidv4 } from 'uuid'

import { createAgentDataDirectory, removeAgentDataDirectory } from './agentDataDirectory'

import { syncHeartbeatSchedule } from './heartbeatSchedule'

const logger = loggerService.withContext('CreateAgent')

export async function createAgent(request: CreateAgentCommand) {
  const agentId = uuidv4()
  const agentsDataRoot = application.getPath('feature.agents.data')
  await createAgentDataDirectory(agentsDataRoot, agentId)

  try {
    const agent = agentService.createAgentWithId(agentId, request)

    // Restore the create-time heartbeat provisioning lost with the legacy
    // SchedulerService (#19203). Failure to schedule must not fail agent
    // creation: the switch still round-trips and the next configuration
    // save re-runs the sync.
    if (request.configuration?.heartbeat_enabled === true) {
      try {
        syncHeartbeatSchedule(agentId)
      } catch (error) {
        logger.warn('Failed to provision heartbeat schedule on create', { agentId, error })
      }
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
