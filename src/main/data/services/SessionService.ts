import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { type WorkspaceRow, workspaceTable } from '@data/db/schemas/workspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbType } from '@data/db/types'
import { pinService } from '@data/services/PinService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { rowToWorkspace, workspaceService } from '@data/services/WorkspaceService'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  CreateSessionDto,
  DeleteSessionsResult,
  ListSessionsQuery,
  UpdateSessionDto
} from '@shared/data/api/schemas/sessions'
import { and, asc, desc, eq, gt, gte, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('SessionService')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

// Cursor wire format: `<orderKey>:<id>`. Stale/legacy cursors fall back
// to first page (warn) instead of throwing — opaque server-issued tokens.
function decodeSessionCursor(raw: string): { key: string; id: string } | null {
  const sep = raw.indexOf(':')
  if (sep < 0) {
    logger.warn('decodeSessionCursor: missing separator, falling back to first page', { cursor: raw })
    return null
  }
  const key = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!key || !id) {
    logger.warn('decodeSessionCursor: empty key or id, falling back to first page', { cursor: raw })
    return null
  }
  return { key, id }
}

type JoinedSessionRow = {
  session: SessionRow
  workspace: WorkspaceRow | null
}
type SessionDeleteTx = Pick<DbType, 'delete'>
type SessionDeleteWorkflowTx = Pick<DbType, 'delete' | 'select'>

function rowToSession(row: JoinedSessionRow): AgentSessionEntity {
  if (row.session.workspaceId && !row.workspace) {
    throw DataApiErrorFactory.notFound('Workspace', row.session.workspaceId)
  }

  return {
    id: row.session.id,
    agentId: row.session.agentId,
    name: row.session.name,
    description: row.session.description,
    workspaceId: row.session.workspaceId,
    workspace: row.workspace ? rowToWorkspace(row.workspace) : null,
    orderKey: row.session.orderKey,
    createdAt: timestampToISO(row.session.createdAt),
    updatedAt: timestampToISO(row.session.updatedAt)
  }
}

function buildSearchPredicate(search: string | undefined): SQL | undefined {
  const trimmed = search?.trim()
  if (!trimmed) return undefined

  const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`
  const nameMatch = sql`${sessionsTable.name} LIKE ${pattern} ESCAPE '\\'`
  const descriptionMatch = sql`${sessionsTable.description} LIKE ${pattern} ESCAPE '\\'`

  return or(nameMatch, descriptionMatch)
}

export class SessionService {
  async createSession(
    dto: CreateSessionDto,
    options: { id?: string; allowSystemWorkspaceId?: boolean } = {}
  ): Promise<AgentSessionEntity> {
    if (dto.workspaceMode === 'system' && dto.workspaceId) {
      throw DataApiErrorFactory.validation({
        workspaceId: ['must be omitted when workspaceMode is system']
      })
    }

    const db = application.get('DbService').getDb()

    // Verify the agent exists; FK alone gives generic 404 — explicit check returns
    // a precise resource = 'Agent'.
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, dto.agentId))
      .limit(1)
    if (!agent) throw DataApiErrorFactory.notFound('Agent', dto.agentId)

    const id = options.id ?? uuidv4()
    const preparedSystemWorkspace =
      dto.workspaceMode === 'system' ? workspaceService.prepareSystemWorkspaceForSession(id) : null
    try {
      await withSqliteErrors(
        () =>
          application.get('DbService').withWriteTx(async (tx) => {
            let workspaceId = dto.workspaceId
            if (workspaceId) {
              await workspaceService.getByIdTx(tx, workspaceId, { includeSystem: options.allowSystemWorkspaceId })
            } else if (preparedSystemWorkspace) {
              workspaceId = (await workspaceService.createPreparedSystemWorkspaceTx(tx, preparedSystemWorkspace)).id
            } else {
              const [sibling] = await tx
                .select({ workspaceId: sessionsTable.workspaceId })
                .from(sessionsTable)
                .innerJoin(workspaceTable, eq(sessionsTable.workspaceId, workspaceTable.id))
                .where(and(eq(sessionsTable.agentId, dto.agentId), eq(workspaceTable.type, 'user')))
                .orderBy(desc(sessionsTable.createdAt))
                .limit(1)
              workspaceId = sibling?.workspaceId ?? (await workspaceService.createDefaultWorkspaceTx(tx)).id
            }

            return insertWithOrderKey(
              tx,
              sessionsTable,
              { id, agentId: dto.agentId, name: dto.name, description: dto.description, workspaceId },
              { pkColumn: sessionsTable.id, position: 'first' }
            )
          }),
        {
          ...defaultHandlersFor('Session', id),
          foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
        }
      )
    } catch (error) {
      if (preparedSystemWorkspace) {
        workspaceService.deletePreparedSystemWorkspaceDirectory(preparedSystemWorkspace)
      }
      throw error
    }

    return await this.getById(id)
  }

  async getById(id: string): Promise<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const [row] = await db
      .select({ session: sessionsTable, workspace: workspaceTable })
      .from(sessionsTable)
      .leftJoin(workspaceTable, eq(sessionsTable.workspaceId, workspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return rowToSession(row)
  }

  async listByCursor(query: ListSessionsQuery = {}): Promise<CursorPaginationResponse<AgentSessionEntity>> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor = query.cursor ? decodeSessionCursor(query.cursor) : null

    const filters: SQL[] = []
    if (query.agentId) filters.push(eq(sessionsTable.agentId, query.agentId))
    const search = buildSearchPredicate(query.search)
    if (search) filters.push(search)
    if (cursor) {
      // Strict tuple: (orderKey, id) > (cursor.key, cursor.id)
      filters.push(
        or(
          gt(sessionsTable.orderKey, cursor.key),
          and(eq(sessionsTable.orderKey, cursor.key), gt(sessionsTable.id, cursor.id))
        )!
      )
    }

    const rows = await db
      .select({ session: sessionsTable, workspace: workspaceTable })
      .from(sessionsTable)
      .leftJoin(workspaceTable, eq(sessionsTable.workspaceId, workspaceTable.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(sessionsTable.orderKey), asc(sessionsTable.id))
      .limit(limit + 1)

    const hasNext = rows.length > limit
    const items = (hasNext ? rows.slice(0, limit) : rows).map(rowToSession)
    const last = items[items.length - 1]
    const nextCursor = hasNext && last ? `${last.orderKey}:${last.id}` : undefined

    return { items, nextCursor }
  }

  async listRecentSearchMatches(query: {
    search: string
    limit: number
    updatedAtFrom?: number
  }): Promise<AgentSessionEntity[]> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit, MAX_LIMIT)
    const filters: SQL[] = []
    const search = buildSearchPredicate(query.search)
    if (search) filters.push(search)
    if (query.updatedAtFrom !== undefined) {
      filters.push(gte(sessionsTable.updatedAt, query.updatedAtFrom))
    }

    const rows = await db
      .select({ session: sessionsTable, workspace: workspaceTable })
      .from(sessionsTable)
      .leftJoin(workspaceTable, eq(sessionsTable.workspaceId, workspaceTable.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(sessionsTable.updatedAt), asc(sessionsTable.id))
      .limit(limit)

    return rows.map(rowToSession)
  }

  async update(id: string, dto: UpdateSessionDto): Promise<AgentSessionEntity> {
    if (Object.keys(dto).length === 0) return this.getById(id)
    const db = application.get('DbService').getDb()
    if (dto.workspaceId) {
      await workspaceService.getById(dto.workspaceId)
    }
    const [row] = await withSqliteErrors(
      () => db.update(sessionsTable).set(dto).where(eq(sessionsTable.id, id)).returning(),
      defaultHandlersFor('Session', id)
    )
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return await this.getById(id)
  }

  async delete(id: string): Promise<void> {
    let systemWorkspacePath: string | null = null
    const dbService = application.get('DbService')
    await dbService.withWriteTx(async (tx) => {
      const row = await this.getDeleteWorkflowRowTx(tx, id)
      if (row.workspace?.type === 'system') {
        workspaceService.assertSystemWorkspacePath(row.workspace.path)
        systemWorkspacePath = row.workspace.path
        await this.deleteByWorkspaceTx(tx, row.workspace.id)
        await workspaceService.deleteByIdTx(tx, row.workspace.id)
        return
      }

      await this.deleteByIdTx(tx, id)
    })
    if (systemWorkspacePath) {
      workspaceService.deleteSystemWorkspaceDirectoryAfterCommit(systemWorkspacePath)
    }
  }

  private async getDeleteWorkflowRowTx(tx: SessionDeleteWorkflowTx, id: string): Promise<JoinedSessionRow> {
    const [row] = await tx
      .select({ session: sessionsTable, workspace: workspaceTable })
      .from(sessionsTable)
      .leftJoin(workspaceTable, eq(sessionsTable.workspaceId, workspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return row
  }

  async deleteByIdTx(tx: SessionDeleteTx, id: string): Promise<void> {
    await this.deleteByIdsTx(tx, [id], { requireAll: true })
  }

  async deleteByIds(ids: string[]): Promise<DeleteSessionsResult> {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return { deletedIds: [], deletedCount: 0 }

    const systemWorkspacePaths: string[] = []
    const dbService = application.get('DbService')
    const deletedIds = await dbService.withWriteTx(async (tx) => {
      const rows = await tx
        .select({ session: sessionsTable, workspace: workspaceTable })
        .from(sessionsTable)
        .leftJoin(workspaceTable, eq(sessionsTable.workspaceId, workspaceTable.id))
        .where(inArray(sessionsTable.id, uniqueIds))

      if (rows.length !== uniqueIds.length) {
        const foundIds = new Set(rows.map((row) => row.session.id))
        const missingId = uniqueIds.find((candidate) => !foundIds.has(candidate)) ?? uniqueIds[0]
        throw DataApiErrorFactory.notFound('Session', missingId)
      }

      const normalSessionIds: string[] = []
      const systemWorkspacePathById = new Map<string, string>()
      for (const row of rows) {
        if (row.workspace?.type === 'system') {
          workspaceService.assertSystemWorkspacePath(row.workspace.path)
          systemWorkspacePathById.set(row.workspace.id, row.workspace.path)
          continue
        }

        normalSessionIds.push(row.session.id)
      }

      const deleted = new Set(await this.deleteByIdsTx(tx, normalSessionIds))
      for (const [workspaceId, workspacePath] of systemWorkspacePathById) {
        const workspaceSessionIds = await this.deleteByWorkspaceTx(tx, workspaceId)
        for (const id of workspaceSessionIds) {
          deleted.add(id)
        }
        await workspaceService.deleteByIdTx(tx, workspaceId)
        systemWorkspacePaths.push(workspacePath)
      }

      return Array.from(deleted)
    })

    for (const path of systemWorkspacePaths) {
      workspaceService.deleteSystemWorkspaceDirectoryAfterCommit(path)
    }

    logger.info('Deleted sessions', { count: deletedIds.length })

    return { deletedIds, deletedCount: deletedIds.length }
  }

  async deleteByWorkspaceTx(tx: SessionDeleteTx, workspaceId: string): Promise<string[]> {
    const deletedSessions = await tx
      .delete(sessionsTable)
      .where(eq(sessionsTable.workspaceId, workspaceId))
      .returning({ id: sessionsTable.id })
    const sessionIds = deletedSessions.map((session) => session.id)
    await pinService.purgeForEntitiesTx(tx, 'session', sessionIds)
    return sessionIds
  }

  async deleteByAgentId(agentId: string): Promise<DeleteSessionsResult> {
    const systemWorkspacePaths: string[] = []
    const dbService = application.get('DbService')
    const deletedIds = await dbService.withWriteTx(async (tx) => {
      const [agent] = await tx
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
        .limit(1)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', agentId)

      const rows = await tx
        .select({ session: sessionsTable, workspace: workspaceTable })
        .from(sessionsTable)
        .leftJoin(workspaceTable, eq(sessionsTable.workspaceId, workspaceTable.id))
        .where(eq(sessionsTable.agentId, agentId))

      const normalSessionIds: string[] = []
      const systemWorkspacePathById = new Map<string, string>()
      for (const row of rows) {
        if (row.workspace?.type === 'system') {
          workspaceService.assertSystemWorkspacePath(row.workspace.path)
          systemWorkspacePathById.set(row.workspace.id, row.workspace.path)
          continue
        }

        normalSessionIds.push(row.session.id)
      }

      const deleted = new Set(await this.deleteByIdsTx(tx, normalSessionIds))
      for (const [workspaceId, workspacePath] of systemWorkspacePathById) {
        const workspaceSessionIds = await this.deleteByWorkspaceTx(tx, workspaceId)
        for (const id of workspaceSessionIds) {
          deleted.add(id)
        }
        await workspaceService.deleteByIdTx(tx, workspaceId)
        systemWorkspacePaths.push(workspacePath)
      }

      return Array.from(deleted)
    })

    for (const path of systemWorkspacePaths) {
      workspaceService.deleteSystemWorkspaceDirectoryAfterCommit(path)
    }

    logger.info('Deleted agent sessions', { agentId, count: deletedIds.length })

    return { deletedIds, deletedCount: deletedIds.length }
  }

  private async deleteByIdsTx(
    tx: SessionDeleteTx,
    ids: string[],
    options: { requireAll?: boolean } = {}
  ): Promise<string[]> {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = await tx.delete(sessionsTable).where(inArray(sessionsTable.id, uniqueIds)).returning({
      id: sessionsTable.id
    })
    const deletedIds = rows.map((row) => row.id)

    if (options.requireAll && deletedIds.length !== uniqueIds.length) {
      const foundIds = new Set(deletedIds)
      const missingId = uniqueIds.find((candidate) => !foundIds.has(candidate)) ?? uniqueIds[0]
      throw DataApiErrorFactory.notFound('Session', missingId)
    }

    await pinService.purgeForEntitiesTx(tx, 'session', deletedIds)

    return deletedIds
  }

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      const [target] = await tx
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, id))
        .limit(1)
      if (!target) throw DataApiErrorFactory.notFound('Session', id)

      await applyMoves(tx, sessionsTable, [{ id, anchor }], { pkColumn: sessionsTable.id })
    })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    const db = application.get('DbService').getDb()
    await db.transaction((tx) => applyMoves(tx, sessionsTable, moves, { pkColumn: sessionsTable.id }))
  }

  async exists(id: string): Promise<boolean> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)
    return !!row
  }
}

export const sessionService = new SessionService()
