import { application } from '@application'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { DataApiErrorFactory } from '@shared/data/api'
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
      const dbService = application.get('DbService')
      return await withSqliteErrors(
        () => dbService.withWriteTx((tx) => agentWorkspaceService.createPreparedSystemWorkspaceTx(tx, prepared)),
        {
          ...defaultHandlersFor('Workspace', prepared.id),
          unique: () => DataApiErrorFactory.conflict(`Workspace path '${prepared.path}' already exists`, 'Workspace')
        }
      )
    } catch (error) {
      agentWorkspaceDirectoryService.deletePreparedSystemWorkspaceDirectory(prepared)
      throw error
    }
  }

  async deleteWorkspace(id: string, options: { includeSystem?: boolean } = {}): Promise<void> {
    let systemWorkspacePath: string | null = null
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      const workspace = await agentWorkspaceService.getRowByIdTx(tx, id, { includeSystem: options.includeSystem })
      if (workspace.type === 'system') {
        agentWorkspaceDirectoryService.assertSystemWorkspacePath(workspace.path)
        systemWorkspacePath = workspace.path
      }
      await agentSessionService.deleteByWorkspaceTx(tx, id)
      await agentWorkspaceService.deleteByIdTx(tx, id)
    })
    if (systemWorkspacePath) {
      agentWorkspaceDirectoryService.deleteSystemWorkspaceDirectoryAfterCommit(systemWorkspacePath)
    }
  }
}

export const agentWorkspaceWorkflowService = new AgentWorkspaceWorkflowService()
