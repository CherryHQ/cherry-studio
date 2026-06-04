import { application } from '@application'
import { type WorkspaceRow, workspaceTable, type WorkspaceType } from '@data/db/schemas/workspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { WorkspaceEntity } from '@shared/data/api/schemas/workspaces'
import { and, asc, eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('WorkspaceService')

type WorkspaceLookupOptions = { includeSystem?: boolean }
type PreparedSystemWorkspace = {
  id: string
  name: string
  path: string
  type: Extract<WorkspaceType, 'system'>
}

export function rowToWorkspace(row: WorkspaceRow): WorkspaceEntity {
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

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatSystemWorkspaceDate(now: Date): { datePart: string; timePart: string; label: string } {
  const datePart = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`
  const timePart = `${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`
  const label = `${datePart} ${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`
  return { datePart, timePart, label }
}

function sanitizeSessionIdSegment(sessionId: string): string {
  const sanitized = sessionId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return (sanitized || uuidv4()).slice(0, 8)
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
  async list(options: WorkspaceLookupOptions = {}): Promise<WorkspaceEntity[]> {
    const db = application.get('DbService').getDb()
    const rows = await db
      .select()
      .from(workspaceTable)
      .where(options.includeSystem ? undefined : eq(workspaceTable.type, 'user'))
      .orderBy(asc(workspaceTable.orderKey), asc(workspaceTable.id))
    return rows.map(rowToWorkspace)
  }

  async getById(id: string, options: WorkspaceLookupOptions = {}): Promise<WorkspaceEntity> {
    const db = application.get('DbService').getDb()
    const row = await this.getRowByIdTx(db, id, options)
    return rowToWorkspace(row)
  }

  async getByIdTx(tx: DbOrTx, id: string, options: WorkspaceLookupOptions = {}): Promise<WorkspaceEntity> {
    const row = await this.getRowByIdTx(tx, id, options)
    return rowToWorkspace(row)
  }

  async getRowByIdTx(tx: DbOrTx, id: string, options: WorkspaceLookupOptions = {}): Promise<WorkspaceRow> {
    const predicate = options.includeSystem
      ? eq(workspaceTable.id, id)
      : and(eq(workspaceTable.id, id), eq(workspaceTable.type, 'user'))
    const [row] = await tx.select().from(workspaceTable).where(predicate).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
    return row
  }

  async deleteByIdTx(tx: DbOrTx, id: string): Promise<void> {
    const [row] = await tx.delete(workspaceTable).where(eq(workspaceTable.id, id)).returning({ id: workspaceTable.id })
    if (!row) throw DataApiErrorFactory.notFound('Workspace', id)
  }

  async findOrCreateByPath(rawPath: string, options: { name?: string } = {}): Promise<WorkspaceEntity> {
    const workspacePath = normalizeWorkspacePath(rawPath)
    ensureWorkspaceDirectory(workspacePath)

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

  async findOrCreateByPathTx(tx: DbOrTx, rawPath: string, options: { name?: string } = {}): Promise<WorkspaceEntity> {
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

  async createDefaultWorkspaceTx(tx: DbOrTx): Promise<WorkspaceEntity> {
    const workspacePath = path.join(application.getPath('feature.agents.workspaces'), uuidv4())
    return await this.findOrCreateByPathTx(tx, workspacePath)
  }

  prepareSystemWorkspaceForSession(sessionId: string, now = new Date()): PreparedSystemWorkspace {
    const { datePart, timePart, label } = formatSystemWorkspaceDate(now)
    const workspacePath = path.join(
      application.getPath('feature.agents.workspaces'),
      'system',
      datePart,
      `${timePart}-${sanitizeSessionIdSegment(sessionId)}`
    )
    ensureWorkspaceDirectory(workspacePath)
    return {
      id: uuidv4(),
      name: `No project ${label}`,
      path: workspacePath,
      type: 'system'
    }
  }

  async createPreparedSystemWorkspaceTx(tx: DbOrTx, prepared: PreparedSystemWorkspace): Promise<WorkspaceEntity> {
    const row = await this.insertWorkspaceRowTx(tx, prepared)
    return rowToWorkspace(row)
  }

  async createSystemWorkspaceForSession(sessionId: string, now = new Date()): Promise<WorkspaceEntity> {
    const prepared = this.prepareSystemWorkspaceForSession(sessionId, now)
    try {
      const dbService = application.get('DbService')
      return await withSqliteErrors(
        () => dbService.withWriteTx((tx) => this.createPreparedSystemWorkspaceTx(tx, prepared)),
        {
          ...defaultHandlersFor('Workspace', prepared.id),
          unique: () => DataApiErrorFactory.conflict(`Workspace path '${prepared.path}' already exists`, 'Workspace')
        }
      )
    } catch (error) {
      this.deletePreparedSystemWorkspaceDirectory(prepared)
      throw error
    }
  }

  assertSystemWorkspacePath(workspacePath: string): void {
    const systemRoot = path.resolve(application.getPath('feature.agents.workspaces'), 'system')
    const targetPath = path.resolve(workspacePath)
    const relative = path.relative(systemRoot, targetPath)
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw DataApiErrorFactory.validation({ path: ['System workspace path is outside the system workspace root'] })
    }
  }

  deleteSystemWorkspaceDirectory(workspacePath: string): void {
    this.assertSystemWorkspacePath(workspacePath)
    fs.rmSync(workspacePath, { recursive: true, force: true })
  }

  deleteSystemWorkspaceDirectoryAfterCommit(workspacePath: string): void {
    try {
      this.deleteSystemWorkspaceDirectory(workspacePath)
    } catch (error) {
      logger.error('Failed to delete system workspace directory after database delete', {
        path: workspacePath,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  deletePreparedSystemWorkspaceDirectory(prepared: PreparedSystemWorkspace): void {
    try {
      this.deleteSystemWorkspaceDirectory(prepared.path)
    } catch (error) {
      logger.warn('Failed to clean prepared system workspace directory', {
        path: prepared.path,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }

  private async findOrCreateRowByNormalizedPathTx(
    tx: DbOrTx,
    workspacePath: string,
    options: { name?: string } = {}
  ): Promise<WorkspaceRow> {
    const [existing] = await tx
      .select()
      .from(workspaceTable)
      .where(and(eq(workspaceTable.path, workspacePath), eq(workspaceTable.type, 'user')))
      .limit(1)
    if (existing) return existing

    const id = uuidv4()
    const name = options.name?.trim() || defaultWorkspaceName(workspacePath)
    return await this.insertWorkspaceRowTx(tx, { id, name, path: workspacePath, type: 'user' })
  }

  private async insertWorkspaceRowTx(
    tx: DbOrTx,
    workspace: { id: string; name: string; path: string; type: WorkspaceType }
  ): Promise<WorkspaceRow> {
    return (await insertWithOrderKey(tx, workspaceTable, workspace, {
      pkColumn: workspaceTable.id,
      position: 'first'
    })) as WorkspaceRow
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
