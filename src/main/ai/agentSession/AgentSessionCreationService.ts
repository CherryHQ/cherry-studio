import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceDirectoryService } from '@main/ai/agentWorkspace/AgentWorkspaceDirectoryService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionEntity, CreateAgentSessionDto } from '@shared/data/api/schemas/agentSessions'
import { v4 as uuidv4 } from 'uuid'

export class AgentSessionCreationService {
  async createSession(dto: CreateAgentSessionDto): Promise<AgentSessionEntity> {
    const id = uuidv4()
    let defaultWorkspacePath: string | null = null
    let keepDefaultWorkspaceDirectory = false

    try {
      let result = await agentSessionService.createWithWorkspaceResolution(dto, { id })

      if (result.needsDefaultWorkspace) {
        defaultWorkspacePath = agentWorkspaceDirectoryService.prepareDefaultWorkspaceDirectory()
        result = await agentSessionService.createWithWorkspaceResolution(dto, { id, defaultWorkspacePath })
      }

      if (result.needsDefaultWorkspace) {
        throw DataApiErrorFactory.invalidOperation('create session', 'default workspace path was not consumed')
      }
      keepDefaultWorkspaceDirectory = result.usedDefaultWorkspace
      return await agentSessionService.getById(result.sessionId)
    } finally {
      if (defaultWorkspacePath && !keepDefaultWorkspaceDirectory) {
        agentWorkspaceDirectoryService.cleanupPreparedWorkspaceDirectory(defaultWorkspacePath)
      }
    }
  }
}

export const agentSessionCreationService = new AgentSessionCreationService()
