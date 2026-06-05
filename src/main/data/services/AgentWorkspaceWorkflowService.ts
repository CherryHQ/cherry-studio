import { application } from '@application'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { and, eq, isNull } from 'drizzle-orm'

export class AgentWorkspaceWorkflowService {
  async deleteWorkspace(id: string, options: { includeSystem?: boolean } = {}): Promise<void> {
    let systemWorkspacePath: string | null = null
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      const workspace = await agentWorkspaceService.getRowByIdTx(tx, id, { includeSystem: options.includeSystem })
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

  async sweepOrphanSystemWorkspaces(): Promise<number> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select({ id: agentWorkspaceTable.id })
      .from(agentWorkspaceTable)
      .leftJoin(agentSessionTable, eq(agentSessionTable.workspaceId, agentWorkspaceTable.id))
      .where(and(eq(agentWorkspaceTable.type, 'system'), isNull(agentSessionTable.id)))

    for (const row of rows) {
      await this.deleteWorkspace(row.id, { includeSystem: true })
    }

    return rows.length
  }
}

export const agentWorkspaceWorkflowService = new AgentWorkspaceWorkflowService()
