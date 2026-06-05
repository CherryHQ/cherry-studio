import { application } from '@application'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { applyMoves, insertWithOrderKey } from '@data/services/utils/orderKey'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentWorkspaceEntity, AgentWorkspaceType } from '@shared/data/api/schemas/agentWorkspaces'
import { and, asc, eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('AgentWorkspaceService')

type WorkspaceLookupOptions = { includeSystem?: boolean }
type PreparedSystemWorkspace = {
  id: string
  name: string
  path: string
  type: Extract<AgentWorkspaceType, 'system'>
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

  prepareDefaultWorkspaceDirectory(): string {
    const workspacePath = path.join(application.getPath('feature.agents.workspaces'), uuidv4())
    ensureWorkspaceDirectory(workspacePath)
    return workspacePath
  }

  cleanupPreparedWorkspaceDirectory(workspacePath: string): void {
    cleanupPreparedWorkspaceDirectory(workspacePath)
  }

  async createDefaultWorkspaceTx(tx: DbOrTx, workspacePath: string): Promise<AgentWorkspaceEntity> {
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

  async createPreparedSystemWorkspaceTx(tx: DbOrTx, prepared: PreparedSystemWorkspace): Promise<AgentWorkspaceEntity> {
    const row = await this.insertWorkspaceRowTx(tx, prepared)
    return rowToWorkspace(row)
  }

  async createSystemWorkspaceForSession(sessionId: string, now = new Date()): Promise<AgentWorkspaceEntity> {
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
      this.assertSystemWorkspacePath(prepared.path)
      fs.rmdirSync(prepared.path)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return
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
