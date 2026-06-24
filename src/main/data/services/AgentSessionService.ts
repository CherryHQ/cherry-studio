import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentWorkspaceService, rowToAgentWorkspace } from '@data/services/AgentWorkspaceService'
import { pinService } from '@data/services/PinService'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  ListAgentSessionsQuery,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE } from '@shared/data/api/schemas/agentWorkspaces'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import { and, asc, desc, eq, gte, inArray, isNull, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { asStringKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('AgentSessionService')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
type SessionEntitySearchItem = Extract<EntitySearchItem, { type: 'session' }>

type JoinedSessionRow = {
  session: SessionRow
  workspace: AgentWorkspaceRow
}

function rowToSession(row: JoinedSessionRow): AgentSessionEntity {
  const clean = nullsToUndefined(row.session)
  return {
    ...clean,
    // agentId is legitimately nullable (orphans only via cascade) — preserve T | null.
    agentId: row.session.agentId,
    workspace: rowToAgentWorkspace(row.workspace),
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

export class AgentSessionService {
  async search(query: { q: string; limit: number; updatedAtFrom?: number }): Promise<SessionEntitySearchItem[]> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit, MAX_LIMIT)
    const filters: SQL[] = []
    const search = buildSearchPredicate(query.q)
    if (search) filters.push(search)
    if (query.updatedAtFrom !== undefined) {
      filters.push(gte(sessionsTable.updatedAt, query.updatedAtFrom))
    }

    const rows = await db
      .select({
        id: sessionsTable.id,
        agentId: sessionsTable.agentId,
        agentName: agentsTable.name,
        name: sessionsTable.name,
        updatedAt: sessionsTable.updatedAt
      })
      .from(sessionsTable)
      .leftJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(sessionsTable.updatedAt), asc(sessionsTable.id))
      .limit(limit)

    return rows.map((row) => ({
      type: 'session',
      id: row.id,
      title: row.name,
      subtitle: row.agentName ?? undefined,
      updatedAt: timestampToISO(row.updatedAt),
      target: { sessionId: row.id, agentId: row.agentId }
    }))
  }

  async create(dto: CreateAgentSessionDto): Promise<AgentSessionEntity> {
    const id = uuidv4()
    await withSqliteErrors(() => application.get('DbService').withWriteTx((tx) => this.createTx(tx, id, dto)), {
      ...defaultHandlersFor('Session', id),
      foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
    })
    return await this.getById(id)
  }

  private async createTx(tx: DbOrTx, id: string, dto: CreateAgentSessionDto): Promise<void> {
    await this.assertAgentExistsTx(tx, dto.agentId)

    let workspaceId: string
    switch (dto.workspace.type) {
      case AGENT_WORKSPACE_TYPE.USER: {
        const workspace = await agentWorkspaceService.getByIdTx(tx, dto.workspace.workspaceId, { includeSystem: true })
        if (workspace.type !== AGENT_WORKSPACE_TYPE.USER) {
          throw DataApiErrorFactory.invalidOperation(
            'create session',
            'workspace source must reference a user workspace'
          )
        }
        workspaceId = workspace.id
        break
      }
      case AGENT_WORKSPACE_TYPE.SYSTEM: {
        workspaceId = (await agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: id })).id
        break
      }
      default: {
        const exhaustive: never = dto.workspace
        throw DataApiErrorFactory.invalidOperation(
          'create session',
          `unsupported workspace source: ${String(exhaustive)}`
        )
      }
    }

    await this.insertTx(tx, {
      id,
      agentId: dto.agentId,
      name: dto.name,
      description: dto.description,
      workspaceId
    })
  }

  private async assertAgentExistsTx(tx: DbOrTx, agentId: string): Promise<void> {
    const [agent] = await tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)
    if (!agent) throw DataApiErrorFactory.notFound('Agent', agentId)
  }

  async getById(id: string): Promise<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const [row] = await db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return rowToSession(row)
  }

  async ensureTraceId(sessionId: string): Promise<string> {
    return application.get('DbService').withWriteTx(async (tx) => {
      const [row] = await tx
        .select({ traceId: sessionsTable.traceId })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1)

      if (!row) throw DataApiErrorFactory.notFound('Session', sessionId)
      if (row.traceId) return row.traceId

      const traceId = randomBytes(16).toString('hex')
      await tx.update(sessionsTable).set({ traceId }).where(eq(sessionsTable.id, sessionId))
      return traceId
    })
  }

  async listByCursor(query: ListAgentSessionsQuery = {}): Promise<CursorPaginationResponse<AgentSessionEntity>> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const ordering = keysetOrdering(sessionsTable.orderKey, sessionsTable.id, { major: 'asc', tie: 'asc' })
    const cursor = decodeListCursor(query.cursor, asStringKey, 'agent-session')

    const filters: SQL[] = []
    if (query.agentId) filters.push(eq(sessionsTable.agentId, query.agentId))
    if (cursor) {
      filters.push(ordering.where(cursor))
    }

    const rows = await db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)

    const hasNext = rows.length > limit
    const items = (hasNext ? rows.slice(0, limit) : rows).map(rowToSession)
    const last = items[items.length - 1]
    const nextCursor = hasNext && last ? encodeCursor(last.orderKey, last.id) : undefined

    return { items, nextCursor }
  }

  async update(id: string, dto: UpdateAgentSessionDto): Promise<AgentSessionEntity> {
    const patch: UpdateAgentSessionDto = {}
    if (dto.name !== undefined) patch.name = dto.name
    if (dto.description !== undefined) patch.description = dto.description
    if (dto.agentId !== undefined) patch.agentId = dto.agentId
    if (Object.keys(patch).length === 0) return this.getById(id)

    const row = await withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.updateTx(tx, id, patch)),
      defaultHandlersFor('Session', id)
    )
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return await this.getById(id)
  }

  async updateTx(tx: DbOrTx, id: string, patch: UpdateAgentSessionDto): Promise<SessionRow | undefined> {
    const [row] = await tx.update(sessionsTable).set(patch).where(eq(sessionsTable.id, id)).returning()
    return row
  }

  private async insertTx(
    tx: DbOrTx,
    values: {
      id: string
      agentId: string
      name: string
      description?: string
      workspaceId: string
    }
  ): Promise<void> {
    await insertWithOrderKey(tx, sessionsTable, values, { pkColumn: sessionsTable.id, position: 'first' })
  }

  async delete(id: string): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.deleteTx(tx, id))
  }

  async deleteTx(tx: DbOrTx, id: string): Promise<void> {
    const [row] = await tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Session', id)

    await this.cascadeDeleteSessionRowsTx(tx, [row])
  }

  async deleteByIds(ids: string[]): Promise<DeleteAgentSessionsResult> {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return { deletedIds: [] }

    const deletedIds = await application.get('DbService').withWriteTx(async (tx) => {
      const rows = await tx
        .select({ session: sessionsTable, workspace: agentWorkspaceTable })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(inArray(sessionsTable.id, uniqueIds))

      return await this.cascadeDeleteSessionRowsTx(tx, rows)
    })

    logger.info('Deleted sessions', { count: deletedIds.length })
    return { deletedIds }
  }

  async deleteWorkspaceCascade(workspaceId: string): Promise<void> {
    await application.get('DbService').withWriteTx(async (tx) => {
      await agentWorkspaceService.getRowByIdTx(tx, workspaceId)
      await this.deleteByWorkspaceTx(tx, workspaceId)
      await agentWorkspaceService.deleteByIdTx(tx, workspaceId)
    })
  }

  async deleteByWorkspaceTx(tx: DbOrTx, workspaceId: string): Promise<string[]> {
    const deletedSessions = await tx
      .delete(sessionsTable)
      .where(eq(sessionsTable.workspaceId, workspaceId))
      .returning({ id: sessionsTable.id })
    const sessionIds = deletedSessions.map((session) => session.id)
    await pinService.purgeForEntitiesTx(tx, 'session', sessionIds)
    return sessionIds
  }

  async deleteByAgentId(agentId: string): Promise<DeleteAgentSessionsResult> {
    const deletedIds = await application.get('DbService').withWriteTx(async (tx) => {
      const [agent] = await tx
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
        .limit(1)
      if (!agent) throw DataApiErrorFactory.notFound('Agent', agentId)

      const rows = await tx
        .select({ session: sessionsTable, workspace: agentWorkspaceTable })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(eq(sessionsTable.agentId, agentId))

      return await this.cascadeDeleteSessionRowsTx(tx, rows)
    })

    logger.info('Deleted agent sessions', { agentId, count: deletedIds.length })
    return { deletedIds }
  }

  private async cascadeDeleteSessionRowsTx(tx: DbOrTx, rows: JoinedSessionRow[]): Promise<string[]> {
    const normalSessionIds: string[] = []
    const systemWorkspaceIds = new Set<string>()
    for (const row of rows) {
      // Deleting through a system workspace removes its tied session rows before
      // the backing workspace row.
      if (row.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM) {
        systemWorkspaceIds.add(row.workspace.id)
      } else {
        normalSessionIds.push(row.session.id)
      }
    }

    const deleted = new Set(await this.deleteByIdsTx(tx, normalSessionIds))
    for (const workspaceId of systemWorkspaceIds) {
      const workspaceSessionIds = await this.deleteByWorkspaceTx(tx, workspaceId)
      for (const id of workspaceSessionIds) {
        deleted.add(id)
      }
      await agentWorkspaceService.deleteByIdTx(tx, workspaceId)
    }

    return Array.from(deleted)
  }

  private async deleteByIdsTx(tx: DbOrTx, ids: string[]): Promise<string[]> {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = await tx.delete(sessionsTable).where(inArray(sessionsTable.id, uniqueIds)).returning({
      id: sessionsTable.id
    })
    const deletedIds = rows.map((row) => row.id)

    await pinService.purgeForEntitiesTx(tx, 'session', deletedIds)
    return deletedIds
  }

  async reorder(id: string, anchor: OrderRequest): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
  }

  async reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): Promise<void> {
    const [target] = await tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1)
    if (!target) throw DataApiErrorFactory.notFound('Session', id)

    await applyMoves(tx, sessionsTable, [{ id, anchor }], { pkColumn: sessionsTable.id })
  }

  async reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    if (moves.length === 0) return
    await application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  async reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): Promise<void> {
    await applyMoves(tx, sessionsTable, moves, { pkColumn: sessionsTable.id })
  }

  async exists(id: string): Promise<boolean> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)
    return !!row
  }
}

export const agentSessionService = new AgentSessionService()
