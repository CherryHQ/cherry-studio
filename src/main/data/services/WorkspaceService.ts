import { application } from '@application'
import { type WorkspaceRow, workspaceTable } from '@data/db/schemas/workspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
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

const logger = loggerService.withContext('WorkspaceService')

type WorkspaceTx = Pick<DbType, 'select' | 'insert'>

export function rowToWorkspace(row: WorkspaceRow): WorkspaceEntity {
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

export class WorkspaceService {
  async list(): Promise<WorkspaceEntity[]> {
    const db = application.get('DbService').getDb()
    const rows = await db.select().from(workspaceTable).orderBy(asc(workspaceTable.orderKey), asc(workspaceTable.id))
    return rows.map(rowToWorkspace)
  }

  async getById(id: string): Promise<WorkspaceEntity> {
    const db = application.get('DbService').getDb()
    const row = await this.getRowByIdTx(db, id)
    return rowToWorkspace(row)
  }

  async getByIdTx(tx: WorkspaceTx, id: string): Promise<WorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id)
    return rowToWorkspace(row)
  }

  async getRowByIdTx(tx: WorkspaceTx, id: string): Promise<WorkspaceRow> {
    const [row] = await tx.select().from(workspaceTable).where(eq(workspaceTable.id, id)).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return row
  }

  async findOrCreateByPath(rawPath: string, options: { name?: string } = {}): Promise<WorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    ensureWorkspaceDirectory(workspacePath)

    const db = application.get('DbService').getDb()
    const row = await withSqliteErrors(
      () => db.transaction((tx) => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options)),
      {
        ...defaultHandlersFor('Workspace', workspacePath),
        unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
      }
    )

    return rowToWorkspace(row)
  }

  async findOrCreateByPathTx(
    tx: WorkspaceTx,
    rawPath: string,
    options: { name?: string } = {}
  ): Promise<WorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    ensureWorkspaceDirectory(workspacePath)
    const row = await withSqliteErrors(() => this.findOrCreateRowByNormalizedPathTx(tx, workspacePath, options), {
      ...defaultHandlersFor('Workspace', workspacePath),
      unique: () => DataApiErrorFactory.conflict(`Workspace path '${workspacePath}' already exists`, 'Workspace')
    })
    return rowToWorkspace(row)
  }

  async createDefaultWorkspace(): Promise<WorkspaceEntity> {
    const workspacePath = path.join(application.getPath('feature.agents.workspaces'), uuidv4())
    return await this.findOrCreateByPath(workspacePath)
  }

  async createDefaultWorkspaceTx(tx: WorkspaceTx): Promise<WorkspaceEntity> {
    const workspacePath = path.join(application.getPath('feature.agents.workspaces'), uuidv4())
    return await this.findOrCreateByPathTx(tx, workspacePath)
  }

  private async findOrCreateRowByNormalizedPathTx(
    tx: WorkspaceTx,
    workspacePath: string,
    options: { name?: string } = {}
  ): Promise<WorkspaceRow> {
    const [existing] = await tx.select().from(workspaceTable).where(eq(workspaceTable.path, workspacePath)).limit(1)
    if (existing) return existing

    const id = uuidv4()
    const name = options.name?.trim() || defaultWorkspaceName(workspacePath)
    return (await insertWithOrderKey(
      tx,
      workspaceTable,
      { id, name, path: workspacePath },
      { pkColumn: workspaceTable.id, position: 'first' }
    )) as WorkspaceRow
  }

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: workspaceTable.id }).from(workspaceTable).where(eq(workspaceTable.id, id))
      if (!target) throw DataApiErrorFactory.notFound('Workspace', id)
      await applyMoves(tx, workspaceTable, [{ id, anchor }], { pkColumn: workspaceTable.id })
    })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    const db = application.get('DbService').getDb()
    await db.transaction((tx) => applyMoves(tx, workspaceTable, moves, { pkColumn: workspaceTable.id }))
  }
}

export const workspaceService = new WorkspaceService()
