import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

import { createAgentDataDirectory, removeAgentDataDirectory } from './agentDataDirectory'

const logger = loggerService.withContext('CreateAgent')

export async function createAgent(request: CreateAgentCommand) {
  const agentId = uuidv4()
  const agentsDataRoot = application.getPath('feature.agents.data')
  await createAgentDataDirectory(agentsDataRoot, agentId)

  try {
    const agent = agentService.createAgentWithId(agentId, request)
    // Adapters start only once the Agent and its channels are committed.
    if (request.channels?.length) {
      try {
        application.get('ChannelManager').reconcileAgent(agent.id)
      } catch (error) {
        logger.warn('Failed to start channels for new agent', { agentId, error })
      }
    }
    // Wait for the creation event’s provisioning; failure remains non-fatal and per-agent.
    try {
      await application.get('AgentJobsService').waitForHeartbeat(agent.id)
    } catch (error) {
      logger.warn('Failed to provision heartbeat schedule for new agent', { agentId, error })
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
