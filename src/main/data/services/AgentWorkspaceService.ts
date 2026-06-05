import { application } from '@application'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { WorkspaceEntity } from '@shared/data/api/schemas/workspaces'
import { asc, eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentWorkspaceService')

export function rowToWorkspace(row: AgentWorkspaceRow): WorkspaceEntity {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
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

function ensureWorkspaceDirectory(workspacePath: string): void {
  if (fs.existsSync(workspacePath)) {
    const stats = fs.statSync(workspacePath)
    if (!stats.isDirectory()) {
      throw DataApiErrorFactory.validation({ path: ['Workspace path must be a directory'] })
    }
    return
  }

  try {
    fs.mkdirSync(workspacePath, { recursive: true })
  } catch (error) {
    logger.error('Failed to create workspace directory', {
      path: workspacePath,
      error: error instanceof Error ? error.message : String(error)
    })
    throw error
  }
}

function cleanupPreparedWorkspaceDirectory(workspacePath: string): void {
  try {
    fs.rmdirSync(workspacePath)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return
    logger.warn('Failed to clean up prepared workspace directory', {
      path: workspacePath,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

export class AgentWorkspaceService {
  async list(): Promise<WorkspaceEntity[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select()
      .from(agentWorkspaceTable)
      .orderBy(asc(agentWorkspaceTable.orderKey), asc(agentWorkspaceTable.id))
    return rows.map(rowToWorkspace)
  }

  async getById(id: string): Promise<WorkspaceEntity> {
    const db = application.get('DbService').getDb()
    const row = await this.getRowByIdTx(db, id)
    return rowToWorkspace(row)
  }

  async getByIdTx(tx: DbOrTx, id: string): Promise<WorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id)
    return rowToWorkspace(row)
  }

  async getRowByIdTx(tx: DbOrTx, id: string): Promise<AgentWorkspaceRow> {
    const [row] = await tx.select().from(agentWorkspaceTable).where(eq(agentWorkspaceTable.id, id)).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return row
  }

  async findOrCreateByPath(rawPath: string, options: { name?: string } = {}): Promise<WorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    ensureWorkspaceDirectory(workspacePath)
    return await this.findOrCreatePreparedPath(workspacePath, options)
  }

  async findOrCreateByPathTx(tx: DbOrTx, rawPath: string, options: { name?: string } = {}): Promise<WorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    const row = await withSqliteErrors(() => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options), {
      ...defaultHandlersFor('Workspace', workspacePath),
      unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    })
    return rowToWorkspace(row)
  }

  prepareDefaultWorkspaceDirectory(): string {
    const workspacePath = path.join(application.getPath('feature.agents.workspaces'), uuidv4())
    ensureWorkspaceDirectory(workspacePath)
    return workspacePath
  }

  cleanupPreparedWorkspaceDirectory(workspacePath: string): void {
    cleanupPreparedWorkspaceDirectory(workspacePath)
  }

  async createDefaultWorkspace(): Promise<WorkspaceEntity> {
    const workspacePath = this.prepareDefaultWorkspaceDirectory()
    try {
      return await this.findOrCreatePreparedPath(workspacePath)
    } catch (error) {
      cleanupPreparedWorkspaceDirectory(workspacePath)
      throw error
    }
  }

  async createDefaultWorkspaceTx(tx: DbOrTx, workspacePath: string): Promise<WorkspaceEntity> {
    return await this.findOrCreateByPathTx(tx, workspacePath)
  }

  private async findOrCreatePreparedPath(
    workspacePath: string,
    options: { name?: string } = {}
  ): Promise<WorkspaceEntity> {
    const dbService = application.get('DbService')
    const row = await withSqliteErrors(
      () => dbService.withWriteTx((tx) => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options)),
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
      }
    )

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
    if (existing) return existing

    const id = uuidv4()
    const name = options.name?.trim() || defaultWorkspaceName(workspacePath)
    return (await insertWithOrderKey(
      tx,
      agentWorkspaceTable,
      { id, name, path: workspacePath },
      { pkColumn: agentWorkspaceTable.id, position: 'first' }
    )) as AgentWorkspaceRow
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
