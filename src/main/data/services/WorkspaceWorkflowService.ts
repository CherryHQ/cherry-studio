import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'

export class WorkspaceWorkflowService {
  async deleteWorkspace(id: string): Promise<void> {
    let systemWorkspacePath: string | null = null
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      const workspace = await agentWorkspaceService.getRowByIdTx(tx, id, { includeSystem: true })
      if (workspace.type === 'system') {
        agentWorkspaceService.assertSystemWorkspacePath(workspace.path)
        systemWorkspacePath = workspace.path
      }
      await agentSessionService.deleteByWorkspaceTx(tx, id)
      await agentWorkspaceService.deleteByIdTx(tx, id)
    })
    if (systemWorkspacePath) {
      agentWorkspaceService.deleteSystemWorkspaceDirectoryAfterCommit(systemWorkspacePath)
    }
  }
}

export const workspaceWorkflowService = new WorkspaceWorkflowService()
