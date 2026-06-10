import { application } from '@application'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { normalizeWorkspacePath } from '@main/utils/agentWorkspacePath'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import {
  AGENT_WORKSPACE_TYPE,
  type AgentWorkspaceEntity,
  AgentWorkspaceTypeSchema
} from '@shared/data/api/schemas/agentWorkspaces'
import { asc, eq } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export function rowToWorkspace(row: AgentWorkspaceRow): AgentWorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    type: AgentWorkspaceTypeSchema.parse(row.type),
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function defaultWorkspaceName(workspacePath: string): string {
  return path.basename(workspacePath) || workspacePath
}

export class AgentWorkspaceService {
  async list(): Promise<AgentWorkspaceEntity[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select()
      .from(agentWorkspaceTable)
      .orderBy(asc(agentWorkspaceTable.orderKey), asc(agentWorkspaceTable.id))
    return rows.map(rowToWorkspace)
  }

  async getById(id: string): Promise<AgentWorkspaceEntity> {
    const db = application.get('DbService').getDb()
    const row = await this.getRowByIdTx(db, id)
    return rowToWorkspace(row)
  }

  async getByIdTx(tx: DbOrTx, id: string): Promise<AgentWorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id)
    return rowToWorkspace(row)
  }

  async getRowByIdTx(tx: DbOrTx, id: string): Promise<AgentWorkspaceRow> {
    const [row] = await tx.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, id)).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return row
  }

  async findOrCreateByPathTx(
    tx: DbOrTx,
    rawPath: string,
    options: { name?: string } = {}
  ): Promise<AgentWorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    const row = await withSqliteErrors(() => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options), {
      ...defaultHandlersFor('Workspace', workspacePath),
      unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    })
    return rowToWorkspace(row)
  }

  private async findOrCreateRowByNormalizedPathTx(
    tx: DbOrTx,
    workspacePath: string,
    options: { name?: string } = {}
  ): Promise<AgentWorkspaceRow> {
    const [existing] = await tx
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.path, workspacePath))
      .limit(1)
    if (existing) {
      if (AgentWorkspaceTypeSchema.parse(existing.type) === AGENT_WORKSPACE_TYPE.USER) return existing
      throw DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    }

    const id = uuidv4()
    const name = options.name?.trim() || defaultWorkspaceName(workspacePath)
    return (await insertWithOrderKey(
      tx,
      agentWorkspaceTable,
      { id, name, path: workspacePath, type: AGENT_WORKSPACE_TYPE.USER },
      { pkColumn: agentWorkspaceTable.id, position: 'first' }
    )) as AgentWorkspaceRow
  }

  async createSystemWorkspaceForSessionTx(tx: DbOrTx, input: { sessionId: string }): Promise<AgentWorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(
      path.join(application.getPath('feature.agents.workspaces'), input.sessionId)
    )
    const row = await withSqliteErrors(
      () =>
        insertWithOrderKey(
          tx,
          agentWorkspaceTable,
          {
            id: uuidv4(),
            name: defaultWorkspaceName(workspacePath),
            path: workspacePath,
            type: AGENT_WORKSPACE_TYPE.SYSTEM
          },
          { pkColumn: agentWorkspaceTable.id, position: 'first' }
        ) as Promise<AgentWorkspaceRow>,
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () =>
          DataApiErrorFactory.conflict(`System workspace already exists for session ${input.sessionId}`, 'Workspace')
      }
    )
    return rowToWorkspace(row)
  }

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
  }

  async reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): Promise<void> {
    const [target] = await tx
      .select({ id: agentWorkspaceTable.id })
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, id))
    if (!target) throw DataApiErrorFactory.notFound('Workspace', id)
    await applyMoves(tx, agentWorkspaceTable, [{ id, anchor }], { pkColumn: agentWorkspaceTable.id })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    await application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  async reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    await applyMoves(tx, agentWorkspaceTable, moves, { pkColumn: agentWorkspaceTable.id })
  }
}

export const agentWorkspaceService = new AgentWorkspaceService()
