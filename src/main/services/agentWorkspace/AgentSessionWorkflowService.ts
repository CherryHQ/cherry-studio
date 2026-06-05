import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { DataApiErrorFactory } from '@shared/data/api'
import type { AgentSessionEntity, CreateAgentSessionDto } from '@shared/data/api/schemas/agentSessions'
import { eq } from 'drizzle-orm'
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
    const dbService = application.get('DbService')
    const db = dbService.getDb()

    // Verify the agent exists before preparing any workspace directory. FK alone
    // gives a generic 404; this preserves the precise resource = 'Agent' error.
    const [agent] = await db
      .select({ id: agentTable.id })
      .from(agentTable)
      .where(eq(agentTable.id, dto.agentId))
      .limit(1)
    if (!agent) throw DataApiErrorFactory.notFound('Agent', dto.agentId)

    let defaultWorkspacePath: string | null = null
    let keepDefaultWorkspaceDirectory = false
    const preparedSystemWorkspace =
      dto.workspaceMode === 'system' ? agentWorkspaceDirectoryService.prepareSystemWorkspaceForSession(id) : null

    try {
      const createInTx = async () =>
        await dbService.withWriteTx(async (tx) => {
          let workspaceId: string | null | undefined = dto.workspaceId
          let usedDefaultWorkspace = false

          if (workspaceId) {
            await agentWorkspaceService.getByIdTx(tx, workspaceId)
          } else if (preparedSystemWorkspace) {
            workspaceId = (await agentWorkspaceService.createPreparedSystemWorkspaceTx(tx, preparedSystemWorkspace)).id
          } else {
            workspaceId = await agentSessionService.findLatestUserWorkspaceIdTx(tx, dto.agentId)
            if (!workspaceId) {
              if (!defaultWorkspacePath) {
                return { usedDefaultWorkspace: false, needsDefaultWorkspace: true }
              }
              workspaceId = (await agentWorkspaceService.createDefaultWorkspaceTx(tx, defaultWorkspacePath)).id
              usedDefaultWorkspace = true
            }
          }

          await agentSessionService.createTx(tx, {
            id,
            agentId: dto.agentId,
            name: dto.name,
            description: dto.description,
            workspaceId
          })

          return { usedDefaultWorkspace, needsDefaultWorkspace: false }
        })

      let result = await withSqliteErrors(createInTx, {
        ...defaultHandlersFor('Session', id),
        foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
      })

      if (result.needsDefaultWorkspace) {
        defaultWorkspacePath = agentWorkspaceDirectoryService.prepareDefaultWorkspaceDirectory()
        result = await withSqliteErrors(createInTx, {
          ...defaultHandlersFor('Session', id),
          foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
        })
      }

      keepDefaultWorkspaceDirectory = result.usedDefaultWorkspace
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

    return await agentSessionService.getById(id)
  }

  async deleteSession(id: string): Promise<void> {
    let systemWorkspacePath: string | null = null
    await application.get('DbService').withWriteTx(async (tx) => {
      systemWorkspacePath = await agentSessionService.deleteTx(tx, id)
    })
    if (systemWorkspacePath) {
      agentWorkspaceDirectoryService.deleteSystemWorkspaceDirectoryAfterCommit(systemWorkspacePath)
    }
  }
}

export const agentSessionWorkflowService = new AgentSessionWorkflowService()
