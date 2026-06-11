import { application } from '@application'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'

export class WorkspaceWorkflowService {
  async deleteWorkspace(id: string): Promise<void> {
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      await agentWorkspaceService.getRowByIdTx(tx, id)
      await agentSessionService.deleteByWorkspaceTx(tx, id)
      await agentWorkspaceService.deleteByIdTx(tx, id)
    })
  }
}

export const workspaceWorkflowService = new WorkspaceWorkflowService()
