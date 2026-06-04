import { application } from '@application'
import { type WorkspaceRow, workspaceTable } from '@data/db/schemas/workspace'
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

const logger = loggerService.withContext('WorkspaceService')

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

  async getByIdTx(tx: DbOrTx, id: string): Promise<WorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id)
    return rowToWorkspace(row)
  }

  async getRowByIdTx(tx: DbOrTx, id: string): Promise<WorkspaceRow> {
    const [row] = await tx.select().from(workspaceTable).where(eq(workspaceTable.id, id)).limit(1)
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
    await application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
  }

  async reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): Promise<void> {
    const [target] = await tx.select({ id: workspaceTable.id }).from(workspaceTable).where(eq(workspaceTable.id, id))
    if (!target) throw DataApiErrorFactory.notFound('Workspace', id)
    await applyMoves(tx, workspaceTable, [{ id, anchor }], { pkColumn: workspaceTable.id })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    await application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  async reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    await applyMoves(tx, workspaceTable, moves, { pkColumn: workspaceTable.id })
  }
}

export const workspaceService = new WorkspaceService()
