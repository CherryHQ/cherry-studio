import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentWorkspaceService, rowToWorkspace } from '@data/services/AgentWorkspaceService'
import { pinService } from '@data/services/PinService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  CreateAgentSessionDto,
  ListAgentSessionsQuery,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import { and, asc, desc, eq, gt, gte, isNull, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('AgentSessionService')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
type SessionEntitySearchItem = Extract<EntitySearchItem, { type: 'session' }>

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
  workspace: AgentWorkspaceRow | null
}

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

  async createSession(dto: CreateAgentSessionDto): Promise<AgentSessionEntity> {
    const dbService = application.get('DbService')
    const id = uuidv4()
    const defaultWorkspacePath = dto.workspaceId ? undefined : agentWorkspaceService.prepareDefaultWorkspaceDirectory()
    let keepDefaultWorkspaceDirectory = false

    try {
      const { usedDefaultWorkspace } = await withSqliteErrors(
        () => dbService.withWriteTx((tx) => this.createSessionTx(tx, id, dto, defaultWorkspacePath)),
        {
          ...defaultHandlersFor('Session', id),
          foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
        }
      )
      keepDefaultWorkspaceDirectory = usedDefaultWorkspace
    } finally {
      if (defaultWorkspacePath && !keepDefaultWorkspaceDirectory) {
        agentWorkspaceService.cleanupPreparedWorkspaceDirectory(defaultWorkspacePath)
      }
    }

    return await this.getById(id)
  }

  async createSessionTx(
    tx: DbOrTx,
    id: string,
    dto: CreateAgentSessionDto,
    defaultWorkspacePath?: string
  ): Promise<{ usedDefaultWorkspace: boolean }> {
    // Verify the agent exists; FK alone gives generic 404 — explicit check returns
    // a precise resource = 'Agent'.
    const [agent] = await tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, dto.agentId))
      .limit(1)
    if (!agent) throw DataApiErrorFactory.notFound('Agent', dto.agentId)

    let workspaceId = dto.workspaceId
    let usedDefaultWorkspace = false
    if (workspaceId) {
      await agentWorkspaceService.getByIdTx(tx, workspaceId)
    } else {
      const [sibling] = await tx
        .select({ workspaceId: sessionsTable.workspaceId })
        .from(sessionsTable)
        .where(eq(sessionsTable.agentId, dto.agentId))
        .orderBy(desc(sessionsTable.createdAt))
        .limit(1)
      if (sibling?.workspaceId) {
        workspaceId = sibling.workspaceId
      } else {
        if (!defaultWorkspacePath) {
          throw DataApiErrorFactory.invalidOperation('create session', 'default workspace path was not prepared')
        }
        workspaceId = (await agentWorkspaceService.createDefaultWorkspaceTx(tx, defaultWorkspacePath)).id
        usedDefaultWorkspace = true
      }
    }

    await insertWithOrderKey(
      tx,
      sessionsTable,
      { id, agentId: dto.agentId, name: dto.name, description: dto.description, workspaceId },
      { pkColumn: sessionsTable.id, position: 'first' }
    )

    return { usedDefaultWorkspace }
  }

  async getById(id: string): Promise<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const [row] = await db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .leftJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return rowToSession(row)
  }

  /**
   * Resolve an agent's workspace path WITHOUT creating a session. Sessions for the same
   * agent reuse the most-recent sibling's workspace (see `createSessionTx`), so this returns
   * that shared path, or null when the agent has no session/workspace yet. Used by heartbeat
   * scheduling to read `heartbeat.md` before deciding whether a fire warrants a session.
   */
  async findAgentWorkspacePath(agentId: string): Promise<string | null> {
    const db = application.get('DbService').getDb()
    const [row] = await db
      .select({ path: agentWorkspaceTable.path })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.agentId, agentId))
      .orderBy(desc(sessionsTable.createdAt))
      .limit(1)
    return row?.path ?? null
  }

  async listByCursor(query: ListAgentSessionsQuery = {}): Promise<CursorPaginationResponse<AgentSessionEntity>> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor = query.cursor ? decodeSessionCursor(query.cursor) : null

    const filters: SQL[] = []
    if (query.agentId) filters.push(eq(sessionsTable.agentId, query.agentId))
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
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .leftJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(sessionsTable.orderKey), asc(sessionsTable.id))
      .limit(limit + 1)

    const hasNext = rows.length > limit
    const items = (hasNext ? rows.slice(0, limit) : rows).map(rowToSession)
    const last = items[items.length - 1]
    const nextCursor = hasNext && last ? `${last.orderKey}:${last.id}` : undefined

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

  async delete(id: string): Promise<void> {
    await application.get('DbService').withWriteTx((tx) => this.deleteTx(tx, id))
  }

  async deleteTx(tx: DbOrTx, id: string): Promise<void> {
    const [row] = await tx.delete(sessionsTable).where(eq(sessionsTable.id, id)).returning({ id: sessionsTable.id })
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    await pinService.purgeForEntityTx(tx, 'session', id)
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
