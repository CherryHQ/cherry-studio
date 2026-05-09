import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { pinService } from '@data/services/PinService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { resolveAccessiblePaths } from '@main/services/agents/agentUtils'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  CreateSessionDto,
  ListSessionsQuery,
  UpdateSessionDto
} from '@shared/data/api/schemas/sessions'
import { and, asc, desc, eq, gt, or, type SQL } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { applyMoves, insertWithOrderKey } from './utils/orderKey'

const logger = loggerService.withContext('DataApi:SessionService')

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function rowToSession(row: SessionRow): AgentSessionEntity {
  return {
    id: row.id,
    agentId: row.agentId,
    name: row.name,
    description: row.description || undefined,
    accessiblePaths: row.accessiblePaths,
    orderKey: row.orderKey,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

// Cursor wire format: `<orderKey>:<id>`. Sessions are ordered by `(orderKey, id)`
// ASC; cursor selects rows strictly after the boundary.
function decodeCursor(raw: string): { orderKey: string; id: string } | null {
  const sep = raw.indexOf(':')
  if (sep < 0) {
    logger.warn('decodeCursor: missing separator, falling back to first page', { cursor: raw })
    return null
  }
  const orderKey = raw.slice(0, sep)
  const id = raw.slice(sep + 1)
  if (!orderKey || !id) {
    logger.warn('decodeCursor: empty orderKey or id, falling back to first page', { cursor: raw })
    return null
  }
  return { orderKey, id }
}

function encodeCursor(orderKey: string, id: string): string {
  return `${orderKey}:${id}`
}

export class SessionService {
  async createSession(dto: CreateSessionDto): Promise<AgentSessionEntity> {
    const db = application.get('DbService').getDb()

    // Verify the agent exists; FK alone gives generic 404 — explicit check returns
    // a precise resource = 'Agent'.
    const [agent] = await db
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, dto.agentId))
      .limit(1)
    if (!agent) throw DataApiErrorFactory.notFound('Agent', dto.agentId)

    let workspaceInput = dto.accessiblePaths
    if (!workspaceInput || workspaceInput.length === 0) {
      const [sibling] = await db
        .select({ accessiblePaths: sessionsTable.accessiblePaths })
        .from(sessionsTable)
        .where(eq(sessionsTable.agentId, dto.agentId))
        .orderBy(desc(sessionsTable.createdAt))
        .limit(1)
      if (sibling?.accessiblePaths && sibling.accessiblePaths.length > 0) {
        workspaceInput = sibling.accessiblePaths
      }
    }
    const accessiblePaths = resolveAccessiblePaths(workspaceInput)

    const id = uuidv4()
    const row = await withSqliteErrors(
      () =>
        db.transaction((tx) =>
          insertWithOrderKey(
            tx,
            sessionsTable,
            { id, agentId: dto.agentId, name: dto.name, description: dto.description, accessiblePaths },
            { pkColumn: sessionsTable.id, position: 'first' }
          )
        ),
      {
        ...defaultHandlersFor('Session', id),
        foreignKey: () => DataApiErrorFactory.notFound('Agent', dto.agentId)
      }
    )

    return rowToSession(row as SessionRow)
  }

  async getById(id: string): Promise<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const [row] = await db.select().from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1)
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return rowToSession(row)
  }

  async listByCursor(query: ListSessionsQuery = {}): Promise<CursorPaginationResponse<AgentSessionEntity>> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor = query.cursor ? decodeCursor(query.cursor) : null

    const filters: SQL[] = []
    if (query.agentId) filters.push(eq(sessionsTable.agentId, query.agentId))
    if (cursor) {
      // Strict tuple: (orderKey, id) > (cursor.orderKey, cursor.id)
      filters.push(
        or(
          gt(sessionsTable.orderKey, cursor.orderKey),
          and(eq(sessionsTable.orderKey, cursor.orderKey), gt(sessionsTable.id, cursor.id))
        )!
      )
    }

    const rows = await db
      .select()
      .from(sessionsTable)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(asc(sessionsTable.orderKey), asc(sessionsTable.id))
      .limit(limit + 1)

    const hasNext = rows.length > limit
    const items = (hasNext ? rows.slice(0, limit) : rows).map(rowToSession)
    const last = items[items.length - 1]
    const nextCursor = hasNext && last ? encodeCursor(last.orderKey, last.id) : undefined

    return { items, nextCursor }
  }

  async update(id: string, dto: UpdateSessionDto): Promise<AgentSessionEntity> {
    if (Object.keys(dto).length === 0) return this.getById(id)
    const db = application.get('DbService').getDb()
    const [row] = await withSqliteErrors(
      () => db.update(sessionsTable).set(dto).where(eq(sessionsTable.id, id)).returning(),
      defaultHandlersFor('Session', id)
    )
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return rowToSession(row)
  }

  async delete(id: string): Promise<void> {
    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      const [row] = await tx.delete(sessionsTable).where(eq(sessionsTable.id, id)).returning({ id: sessionsTable.id })
      if (!row) throw DataApiErrorFactory.notFound('Session', id)
      await pinService.purgeForEntity(tx, 'session', id)
    })
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
