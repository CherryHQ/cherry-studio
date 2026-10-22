import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

import { createAgentDataDirectory, removeAgentDataDirectory } from './agentDataDirectory'

const logger = loggerService.withContext('CreateAgent')

export async function createAgent(request: CreateAgentCommand) {
  const presetId = request.type === 'local' ? request.configuration?.localRuntime?.presetId : undefined
  const agentId = presetId ? uuidv5(`cherry-local-agent:${presetId}`, uuidv5.URL) : uuidv4()
  if (request.type === 'local') {
    if (presetId && agentService.getLifecycleState(agentId) === 'trashed') agentService.restoreAgent(agentId)
    const existing = presetId ? agentService.getAgent(agentId) : null
    return existing
      ? agentService.updateAgent(agentId, { name: request.name, configuration: request.configuration })!
      : agentService.createAgentWithId(agentId, request)
  }
  const agentsDataRoot = application.getPath('feature.agents.data')
  await createAgentDataDirectory(agentsDataRoot, agentId)

  try {
    const agent = agentService.createAgentWithId(agentId, request)
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
