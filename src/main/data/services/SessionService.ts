import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { type WorkspaceRow, workspaceTable } from '@data/db/schemas/workspace'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
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
  ListSessionsQuery,
  UpdateSessionDto
} from '@shared/data/api/schemas/sessions'
import { and, asc, desc, eq, gt, or, type SQL } from 'drizzle-orm'
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

function rowToSession(row: JoinedSessionRow): AgentSessionEntity {
  if (row.session.workspaceId && !row.workspace) {
    throw DataApiErrorFactory.notFound('Workspace', row.session.workspaceId)
  }

  return {
    id: row.session.id,
    agentId: row.session.agentId,
    name: row.session.name,
    isNameManuallyEdited: row.session.isNameManuallyEdited,
    description: row.session.description,
    workspaceId: row.session.workspaceId,
    workspace: row.workspace ? rowToWorkspace(row.workspace) : null,
    orderKey: row.session.orderKey,
    createdAt: timestampToISO(row.session.createdAt),
    updatedAt: timestampToISO(row.session.updatedAt)
  }
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

    const id = uuidv4()
    await withSqliteErrors(
      () =>
        db.transaction(async (tx) => {
          let workspaceId = dto.workspaceId
          if (workspaceId) {
            await workspaceService.getByIdTx(tx, workspaceId)
          } else {
            const [sibling] = await tx
              .select({ workspaceId: sessionsTable.workspaceId })
              .from(sessionsTable)
              .where(eq(sessionsTable.agentId, dto.agentId))
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
    const db = application.get('DbService').getDb()
    await db.transaction(async (tx) => {
      const [row] = await tx.delete(sessionsTable).where(eq(sessionsTable.id, id)).returning({ id: sessionsTable.id })
      if (!row) throw DataApiErrorFactory.notFound('Session', id)
      await pinService.purgeForEntityTx(tx, 'session', id)
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
