import { v4 as uuidv4, v5 as uuidv5 } from 'uuid'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { loggerService } from '@logger'
import { withCreatedImageEntry } from '@main/services/entityImageBinding'
import { protectLocalAgentEnvironment } from '@main/services/localAgentCredentials'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

import { createAgentDataDirectory, removeAgentDataDirectory } from './agentDataDirectory'

const logger = loggerService.withContext('CreateAgent')

export async function createAgent(request: CreateAgentCommand) {
  const { avatarImage, ...data } = request
  const presetId = request.type === 'local' ? request.localRuntime?.presetId : undefined
  const agentId = presetId ? uuidv5(`cherry-local-agent:${presetId}`, uuidv5.URL) : uuidv4()
  if (request.type === 'local') {
    if (presetId && agentService.getLifecycleState(agentId) === 'trashed') agentService.restoreAgent(agentId)
    const existing = presetId ? agentService.getAgent(agentId) : null
    const prepared = request.localRuntime && protectLocalAgentEnvironment(request.localRuntime, existing?.id)
    if (!existing) return agentService.createAgentWithId(agentId, { ...data, localRuntime: prepared })
    const { encryptedEnv, account, ...localRuntime } = prepared ?? {}
    return agentService.updateAgent(
      agentId,
      { name: request.name, configuration: request.configuration, localRuntime },
      { localAccount: account, encryptedLocalEnv: encryptedEnv }
    )!
  }
  const agentsDataRoot = application.getPath('feature.agents.data')
  await createAgentDataDirectory(agentsDataRoot, agentId)

  try {
    const agent = avatarImage
      ? await withCreatedImageEntry(avatarImage, 'delete_when_unreferenced', (fileId) =>
          agentService.createAgentWithId(agentId, data, fileId)
        )
      : agentService.createAgentWithId(agentId, data)
    // Adapters start only once the Agent and its channels are committed.
    if (data.channels?.length) {
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
