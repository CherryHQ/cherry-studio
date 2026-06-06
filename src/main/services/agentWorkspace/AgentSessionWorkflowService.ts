import { agentSessionService } from '@data/services/AgentSessionService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionEntity, CreateAgentSessionDto } from '@shared/data/api/schemas/agentSessions'
import { v4 as uuidv4 } from 'uuid'

import { agentWorkspaceDirectoryService } from './AgentWorkspaceDirectoryService'

export class AgentSessionWorkflowService {
  async createSession(dto: CreateAgentSessionDto, options: { id?: string } = {}): Promise<AgentSessionEntity> {
    if (dto.workspaceMode === 'system' && dto.workspaceId) {
      throw DataApiErrorFactory.validation({
        workspaceId: ['must be omitted when workspaceMode is system']
      })
    }

    const id = options.id ?? uuidv4()
    let defaultWorkspacePath: string | null = null
    let keepDefaultWorkspaceDirectory = false
    const preparedSystemWorkspace =
      dto.workspaceMode === 'system' ? agentWorkspaceDirectoryService.prepareSystemWorkspaceForSession(id) : null

    try {
      let result = await agentSessionService.createWithWorkspaceResolution(dto, {
        id,
        systemWorkspace: preparedSystemWorkspace
      })

      if (result.needsDefaultWorkspace) {
        defaultWorkspacePath = agentWorkspaceDirectoryService.prepareDefaultWorkspaceDirectory()
        result = await agentSessionService.createWithWorkspaceResolution(dto, {
          id,
          defaultWorkspacePath,
          systemWorkspace: preparedSystemWorkspace
        })
      }

      keepDefaultWorkspaceDirectory = result.usedDefaultWorkspace
      if (result.needsDefaultWorkspace) {
        throw DataApiErrorFactory.invalidOperation('create session', 'default workspace path was not consumed')
      }
      return result.session
    } catch (error) {
      if (preparedSystemWorkspace) {
        agentWorkspaceDirectoryService.deletePreparedSystemWorkspaceDirectory(preparedSystemWorkspace)
      }
      throw error
    } finally {
      if (defaultWorkspacePath && !keepDefaultWorkspaceDirectory) {
        agentWorkspaceDirectoryService.cleanupPreparedWorkspaceDirectory(defaultWorkspacePath)
      }
    }
  }

  async deleteSession(id: string): Promise<void> {
    const systemWorkspacePath = await agentSessionService.delete(id)
    if (systemWorkspacePath) {
      agentWorkspaceDirectoryService.deleteSystemWorkspaceDirectoryAfterCommit(systemWorkspacePath)
    }
  }
}

export const agentSessionWorkflowService = new AgentSessionWorkflowService()
