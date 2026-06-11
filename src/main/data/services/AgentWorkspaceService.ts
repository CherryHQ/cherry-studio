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
  AgentWorkspaceTypeSchema,
  type UpdateAgentWorkspaceDto
} from '@shared/data/api/schemas/agentWorkspaces'
import { and, asc, eq } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

type AgentWorkspaceLookupOptions = { includeSystem?: boolean }
export type FindOrCreateAgentWorkspaceResult = { workspace: AgentWorkspaceEntity; created: boolean }

export function rowToAgentWorkspace(row: AgentWorkspaceRow): AgentWorkspaceEntity {
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

function normalizeWorkspaceName(rawName: string): string {
  const trimmed = rawName.trim()
  if (!trimmed) {
    throw DataApiErrorFactory.validation({ name: ['Workspace name is required'] })
  }
  return trimmed
}

export class AgentWorkspaceService {
  async list(options: AgentWorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select()
      .from(agentWorkspaceTable)
      .where(options.includeSystem ? undefined : eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER))
      .orderBy(asc(agentWorkspaceTable.orderKey), asc(agentWorkspaceTable.id))
    return rows.map(rowToAgentWorkspace)
  }

  async getById(id: string, options: AgentWorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity> {
    const db = application.get('DbService').getDb()
    const row = await this.getRowByIdTx(db, id, options)
    return rowToAgentWorkspace(row)
  }

  async getByIdTx(tx: DbOrTx, id: string, options: AgentWorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id, options)
    return rowToAgentWorkspace(row)
  }

  async getRowByIdTx(tx: DbOrTx, id: string, options: AgentWorkspaceLookupOptions = {}): Promise<AgentWorkspaceRow> {
    const predicate = options.includeSystem
      ? eq(agentWorkspaceTable.id, id)
      : and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER))
    const [row] = await tx.select().from(agentWorkspaceTable).where(predicate).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return row
  }

  async findOrCreateByPath(rawPath: string, options: { name?: string } = {}): Promise<AgentWorkspaceEntity> {
    return (await this.findOrCreateByPathResult(rawPath, options)).workspace
  }

  async findOrCreateByPathResult(
    rawPath: string,
    options: { name?: string } = {}
  ): Promise<FindOrCreateAgentWorkspaceResult> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    const result = await withSqliteErrors(
      () =>
        application
          .get('DbService')
          .withWriteTx((tx) => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options)),
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
      }
    )
    return { workspace: rowToAgentWorkspace(result.row), created: result.created }
  }

  async findOrCreateByPathTx(
    tx: DbOrTx,
    rawPath: string,
    options: { name?: string } = {}
  ): Promise<AgentWorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    const result = await withSqliteErrors(() => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options), {
      ...defaultHandlersFor('Workspace', workspacePath),
      unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    })
    return rowToAgentWorkspace(result.row)
  }

  private async findOrCreateRowByNormalizedPathTx(
    tx: DbOrTx,
    workspacePath: string,
    options: { name?: string } = {}
  ): Promise<{ row: AgentWorkspaceRow; created: boolean }> {
    const [existing] = await tx
      .select()
      .from(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.path, workspacePath))
      .limit(1)
    if (existing) {
      // Idempotent find branch: POST/find-or-create never renames an existing workspace.
      // Callers that want to rename must use PATCH /agent-workspaces/:workspaceId.
      if (AgentWorkspaceTypeSchema.parse(existing.type) === AGENT_WORKSPACE_TYPE.USER) {
        return { row: existing, created: false }
      }
      throw DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    }

    const id = uuidv4()
    const name = options.name?.trim() || defaultWorkspaceName(workspacePath)
    const row = (await insertWithOrderKey(
      tx,
      agentWorkspaceTable,
      { id, name, path: workspacePath, type: AGENT_WORKSPACE_TYPE.USER },
      { pkColumn: agentWorkspaceTable.id, position: 'first' }
    )) as AgentWorkspaceRow
    return { row, created: true }
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
    return rowToAgentWorkspace(row)
  }

  async update(id: string, dto: UpdateAgentWorkspaceDto): Promise<AgentWorkspaceEntity> {
    const row = await withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx(async (tx) => {
          await this.getRowByIdTx(tx, id)
          const [updated] = await tx
            .update(agentWorkspaceTable)
            .set({ name: normalizeWorkspaceName(dto.name) })
            .where(and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER)))
            .returning()
          return updated
        }),
      defaultHandlersFor('Workspace', id)
    )
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return rowToAgentWorkspace(row)
  }

  async deleteByIdTx(tx: DbOrTx, id: string): Promise<void> {
    const [row] = await tx
      .delete(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, id))
      .returning({ id: agentWorkspaceTable.id })
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
  }

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
  }

  async reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): Promise<void> {
    await this.assertUserWorkspaceExistsTx(tx, id)
    await this.assertUserAnchorExistsTx(tx, anchor)
    await applyMoves(tx, agentWorkspaceTable, [{ id, anchor }], { pkColumn: agentWorkspaceTable.id })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    await application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  async reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    for (const move of moves) {
      await this.assertUserWorkspaceExistsTx(tx, move.id)
      await this.assertUserAnchorExistsTx(tx, move.anchor)
    }
    await applyMoves(tx, agentWorkspaceTable, moves, { pkColumn: agentWorkspaceTable.id })
  }

  private async assertUserWorkspaceExistsTx(tx: DbOrTx, id: string): Promise<void> {
    const [target] = await tx
      .select({ id: agentWorkspaceTable.id })
      .from(agentWorkspaceTable)
      .where(and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER)))
      .limit(1)
    if (!target) throw DataApiErrorFactory.notFound('Workspace', id)
  }

  private async assertUserAnchorExistsTx(tx: DbOrTx, anchor: OrderRequest): Promise<void> {
    const anchorId = 'before' in anchor ? anchor.before : 'after' in anchor ? anchor.after : undefined
    if (!anchorId) return
    await this.assertUserWorkspaceExistsTx(tx, anchorId)
  }
}

export const agentWorkspaceService = new AgentWorkspaceService()
