import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'
import { v4 as uuidv4 } from 'uuid'

import { createAgentDataDirectory, removeAgentDataDirectory } from './agentDataDirectory'

const logger = loggerService.withContext('CreateAgent')

export async function createAgent(request: CreateAgentCommand) {
  return application.get('ProfileWriteBarrierService').runWrite('agent:create', async () => {
    const agentId = uuidv4()
    const agentsDataRoot = application.getPath('feature.agents.data')
    await createAgentDataDirectory(agentsDataRoot, agentId)

    try {
      return agentService.createAgentWithId(agentId, request)
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
  })
}
