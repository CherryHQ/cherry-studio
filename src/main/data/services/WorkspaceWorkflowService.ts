import { application } from '@application'
import { sessionService } from '@data/services/SessionService'
import { workspaceService } from '@data/services/WorkspaceService'

export class WorkspaceWorkflowService {
  async deleteWorkspace(id: string): Promise<void> {
    let systemWorkspacePath: string | null = null
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      const workspace = await workspaceService.getRowByIdTx(tx, id, { includeSystem: true })
      if (workspace.type === 'system') {
        workspaceService.assertSystemWorkspacePath(workspace.path)
        systemWorkspacePath = workspace.path
      }
      await sessionService.deleteByWorkspaceTx(tx, id)
      await workspaceService.deleteByIdTx(tx, id)
    })
    if (systemWorkspacePath) {
      workspaceService.deleteSystemWorkspaceDirectoryAfterCommit(systemWorkspacePath)
    }
  }
}

export const workspaceWorkflowService = new WorkspaceWorkflowService()
