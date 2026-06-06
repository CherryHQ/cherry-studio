import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import type { AgentWorkspaceEntity } from '@shared/data/api/schemas/agentWorkspaces'

import { agentWorkspaceDirectoryService } from './AgentWorkspaceDirectoryService'

export class AgentWorkspaceWorkflowService {
  async findOrCreateWorkspaceByPath(rawPath: string, options: { name?: string } = {}): Promise<AgentWorkspaceEntity> {
    const workspacePath = agentWorkspaceDirectoryService.ensureWorkspaceDirectory(rawPath)
    return await agentWorkspaceService.findOrCreateByPath(workspacePath, options)
  }

  async createSystemWorkspaceForSession(sessionId: string, now = new Date()): Promise<AgentWorkspaceEntity> {
    const prepared = agentWorkspaceDirectoryService.prepareSystemWorkspaceForSession(sessionId, now)
    try {
      return await agentWorkspaceService.createPreparedSystemWorkspace(prepared)
    } catch (error) {
      agentWorkspaceDirectoryService.deletePreparedSystemWorkspaceDirectory(prepared)
      throw error
    }
  }

  async deleteWorkspace(id: string, options: { includeSystem?: boolean } = {}): Promise<void> {
    const systemWorkspacePath = await agentWorkspaceService.deleteWorkspaceWithSessions(id, options)
    if (systemWorkspacePath) {
      agentWorkspaceDirectoryService.deleteSystemWorkspaceDirectoryAfterCommit(systemWorkspacePath)
    }
  }
}

export const agentWorkspaceWorkflowService = new AgentWorkspaceWorkflowService()
