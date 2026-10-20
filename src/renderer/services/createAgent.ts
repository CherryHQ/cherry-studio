import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import type { CreateAgentCommand } from '@shared/ipc/schemas/ai'

const logger = loggerService.withContext('createAgent')

export async function createAgentAndRefresh(
  input: CreateAgentCommand,
  refreshAgents: () => Promise<unknown>
): Promise<AgentEntity> {
  const agent = await ipcApi.request('ai.agent.create', input)
  try {
    await refreshAgents()
  } catch (error) {
    logger.warn('Failed to refresh agents cache after IPC creation', { agentId: agent.id, error })
  }
  return agent
}
