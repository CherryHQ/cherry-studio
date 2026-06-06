import { application } from '@application'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentSessionService } from '@data/services/AgentSessionService'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentWorkspaceEntity, AgentWorkspaceType } from '@shared/data/api/schemas/agentWorkspaces'
import { and, asc, eq } from 'drizzle-orm'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

type WorkspaceLookupOptions = { includeSystem?: boolean }
export type CreateSystemWorkspaceInput = {
  path: string
  name: string
}

export function rowToWorkspace(row: AgentWorkspaceRow): AgentWorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    type: row.type,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function normalizeWorkspacePath(rawPath: string): string {
  const trimmed = rawPath.trim()
  if (!trimmed) {
    throw DataApiErrorFactory.validation({ path: ['Workspace path is required'] })
  }
  if (!path.isAbsolute(trimmed)) {
    throw DataApiErrorFactory.validation({ path: ['Workspace path must be absolute'] })
  }
  return path.normalize(trimmed)
}

function defaultWorkspaceName(workspacePath: string): string {
  return path.basename(workspacePath) || workspacePath
}

export class AgentWorkspaceService {
  async list(options: WorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select()
      .from(agentWorkspaceTable)
      .where(options.includeSystem ? undefined : eq(agentWorkspaceTable.type, 'user'))
      .orderBy(asc(agentWorkspaceTable.orderKey), asc(agentWorkspaceTable.id))
    return rows.map(rowToWorkspace)
  }

  async getById(id: string, options: WorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity> {
    const db = application.get('DbService').getDb()
    const row = await this.getRowByIdTx(db, id, options)
    return rowToWorkspace(row)
  }

  async getByIdTx(tx: DbOrTx, id: string, options: WorkspaceLookupOptions = {}): Promise<AgentWorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id, options)
    return rowToWorkspace(row)
  }

  async getRowByIdTx(tx: DbOrTx, id: string, options: WorkspaceLookupOptions = {}): Promise<AgentWorkspaceRow> {
    const predicate = options.includeSystem
      ? eq(agentWorkspaceTable.id, id)
      : and(eq(agentWorkspaceTable.id, id), eq(agentWorkspaceTable.type, 'user'))
    const [row] = await tx.select().from(agentWorkspaceTable).where(predicate).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return row
  }

  async deleteByIdTx(tx: DbOrTx, id: string): Promise<void> {
    const [row] = await tx
      .delete(agentWorkspaceTable)
      .where(eq(agentWorkspaceTable.id, id))
      .returning({ id: agentWorkspaceTable.id })
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
  }

  async findOrCreateByPath(rawPath: string, options: { name?: string } = {}): Promise<AgentWorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)

    const row = await withSqliteErrors(
      () =>
        application
          .get('DbService')
          .withWriteTx((tx) => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options)),
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
      }
    )

    return rowToWorkspace(row)
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

  async createDefaultWorkspaceTx(tx: DbOrTx, workspacePath: string): Promise<AgentWorkspaceEntity> {
    return await this.findOrCreateByPathTx(tx, workspacePath)
  }

  async createSystemWorkspace(input: CreateSystemWorkspaceInput): Promise<AgentWorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(input.path)
    const row = await withSqliteErrors(
      () =>
        application
          .get('DbService')
          .withWriteTx((tx) => this.createSystemWorkspaceRowTx(tx, { ...input, path: workspacePath })),
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
      }
    )
    return rowToWorkspace(row)
  }

  async createSystemWorkspaceTx(tx: DbOrTx, input: CreateSystemWorkspaceInput): Promise<AgentWorkspaceEntity> {
    const row = await this.createSystemWorkspaceRowTx(tx, input)
    return rowToWorkspace(row)
  }

  private async createSystemWorkspaceRowTx(tx: DbOrTx, input: CreateSystemWorkspaceInput): Promise<AgentWorkspaceRow> {
    const workspacePath = normalizeWorkspacePath(input.path)
    return await this.insertWorkspaceRowTx(tx, {
      id: uuidv4(),
      name: input.name,
      path: workspacePath,
      type: 'system'
    })
  }

  private async findOrCreateRowByNormalizedPathTx(
    tx: DbOrTx,
    workspacePath: string,
    options: { name?: string } = {}
  ): Promise<AgentWorkspaceRow> {
    const [existing] = await tx
      .select()
      .from(agentWorkspaceTable)
      .where(and(eq(agentWorkspaceTable.path, workspacePath), eq(agentWorkspaceTable.type, 'user')))
      .limit(1)
    if (existing) return existing

    const id = uuidv4()
    const name = options.name?.trim() || defaultWorkspaceName(workspacePath)
    return await this.insertWorkspaceRowTx(tx, { id, name, path: workspacePath, type: 'user' })
  }

  private async insertWorkspaceRowTx(
    tx: DbOrTx,
    workspace: { id: string; name: string; path: string; type: AgentWorkspaceType }
  ): Promise<AgentWorkspaceRow> {
    return (await insertWithOrderKey(tx, agentWorkspaceTable, workspace, {
      pkColumn: agentWorkspaceTable.id,
      position: 'first'
    })) as AgentWorkspaceRow
  }

  async deleteWorkspaceWithSessions(id: string, options: WorkspaceLookupOptions = {}): Promise<string | null> {
    return await withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.deleteWorkspaceWithSessionsTx(tx, id, options)),
      defaultHandlersFor('Workspace', id)
    )
  }

  async deleteWorkspaceWithSessionsTx(
    tx: DbOrTx,
    id: string,
    options: WorkspaceLookupOptions = {}
  ): Promise<string | null> {
    const workspace = await this.getRowByIdTx(tx, id, options)
    const systemWorkspacePath = workspace.type === 'system' ? workspace.path : null
    await agentSessionService.deleteByWorkspaceTx(tx, id)
    await this.deleteByIdTx(tx, id)
    return systemWorkspacePath
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
