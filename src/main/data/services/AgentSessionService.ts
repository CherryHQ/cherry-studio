import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentWorkspaceService, rowToAgentWorkspace } from '@data/services/AgentWorkspaceService'
import { pinService } from '@data/services/PinService'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type {
  AgentSessionEntity,
  AgentSessionListItem,
  AgentSessionSortBy,
  AgentSessionStats,
  AgentSessionStatsQuery,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  ListAgentSessionsQuery,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import { and, asc, count, desc, eq, gt, gte, inArray, isNull, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

import { asNumericKey, asStringKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'
import { applyMoves, insertWithOrderKey } from './utils/orderKey'
import {
  decodePinnedListCursor,
  encodeEntityCursor,
  encodeEntitySectionStart,
  encodePinCursor
} from './utils/pinnedListCursor'

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

function toAgentSessionListItem(session: AgentSessionEntity, pinId: string | null): AgentSessionListItem {
  return { ...session, pinned: pinId !== null, pinId }
}

function buildSearchPredicate(search: string | undefined): SQL | undefined {
  const trimmed = search?.trim()
  if (!trimmed) return undefined

  const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`
  const nameMatch = sql`${sessionsTable.name} LIKE ${pattern} ESCAPE '\\'`
  const descriptionMatch = sql`${sessionsTable.description} LIKE ${pattern} ESCAPE '\\'`

  return or(nameMatch, descriptionMatch)
}

/**
 * Search predicate for the flat list/stats paths. `name` matches the
 * session name only; `full` ORs in the description and the owning agent's
 * name (queries using `full` must LEFT JOIN the agent table).
 */
function buildScopedSearchPredicate(q: string | undefined, scope: 'name' | 'full'): SQL | undefined {
  const trimmed = q?.trim()
  if (!trimmed) return undefined
  const pattern = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`
  const nameMatch = sql`${sessionsTable.name} LIKE ${pattern} ESCAPE '\\'`
  if (scope === 'name') return nameMatch
  const descriptionMatch = sql`${sessionsTable.description} LIKE ${pattern} ESCAPE '\\'`
  const agentNameMatch = sql`${agentsTable.name} LIKE ${pattern} ESCAPE '\\'`
  return or(nameMatch, descriptionMatch, agentNameMatch)
}

/**
 * Shared record filters for the flat list and stats paths.
 * `pinned` is NOT built here — it needs the pin subquery and only applies to
 * lists. Sessions are hard-deleted, so there is no deletedAt guard.
 */
function buildSessionRecordFilters(query: {
  q?: string
  searchScope?: 'name' | 'full'
  agentId?: string
  ids?: string[]
  workspaceId?: string
}): SQL[] {
  const filters: SQL[] = []
  const search = buildScopedSearchPredicate(query.q, query.searchScope ?? 'name')
  if (search) filters.push(search)
  if (query.agentId === 'unlinked') {
    filters.push(isNull(sessionsTable.agentId))
  } else if (query.agentId !== undefined) {
    filters.push(eq(sessionsTable.agentId, query.agentId))
  }
  if (query.ids !== undefined) filters.push(inArray(sessionsTable.id, query.ids))
  if (query.workspaceId === 'system') {
    filters.push(eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.SYSTEM))
  } else if (query.workspaceId !== undefined) {
    filters.push(eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER))
    filters.push(eq(sessionsTable.workspaceId, query.workspaceId))
  }
  return filters
}

export class AgentSessionService {
  search(query: { q: string; limit: number; updatedAtFrom?: number }): SessionEntitySearchItem[] {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit, MAX_LIMIT)
    const filters: SQL[] = []
    const search = buildSearchPredicate(query.q)
    if (search) filters.push(search)
    if (query.updatedAtFrom !== undefined) {
      filters.push(gte(sessionsTable.updatedAt, query.updatedAtFrom))
    }

    const rows = db
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
      .all()

    return rows.map((row) => ({
      type: 'session',
      id: row.id,
      title: row.name,
      subtitle: row.agentName ?? undefined,
      updatedAt: timestampToISO(row.updatedAt),
      target: { sessionId: row.id, agentId: row.agentId }
    }))
  }

  create(dto: CreateAgentSessionDto): AgentSessionEntity {
    const id = uuidv4()
    withSqliteErrors(() => application.get('DbService').withWriteTx((tx) => this.createTx(tx, id, dto)), {
      ...defaultHandlersFor('Session', id),
      foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
    })
    return this.getById(id)
  }

  /**
   * Transactional create for seed-time composition. DbService is not marked ready
   * while seeders run, so create() would fail through DbService.withWriteTx().
   */
  createTx(tx: DbOrTx, id: string, dto: CreateAgentSessionDto): void {
    this.assertAgentExistsTx(tx, dto.agentId)

    let workspaceId: string
    switch (dto.workspace.type) {
      case AGENT_WORKSPACE_TYPE.USER: {
        const workspace = agentWorkspaceService.getByIdTx(tx, dto.workspace.workspaceId, { includeSystem: true })
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
        workspaceId = agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: id }).id
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

    this.insertTx(tx, {
      id,
      agentId: dto.agentId,
      name: dto.name,
      description: dto.description,
      workspaceId
    })
  }

  private assertAgentExistsTx(tx: DbOrTx, agentId: string): void {
    const [agent] = tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(eq(agentsTable.id, agentId))
      .limit(1)
      .all()
    if (!agent) throw DataApiErrorFactory.notFound('Agent', agentId)
  }

  getById(id: string): AgentSessionEntity {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return rowToSession(row)
  }

  /**
   * The single most-recently-updated session, or `null` when there are none.
   *
   * First-entry restore resumes the last-touched session. It cannot read the
   * regular first page of `listByCursor` for this: that pages pinned-first then
   * by `orderKey ASC` (creation/manual order, newest-created first), so a
   * recently-active session is not guaranteed to be on it. This
   * `updatedAt DESC LIMIT 1` proves global latest independent of the rail's ordering.
   */
  getLatestUpdated(): AgentSessionEntity | null {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .orderBy(desc(sessionsTable.updatedAt), asc(sessionsTable.id))
      .limit(1)
      .all()
    return row ? rowToSession(row) : null
  }

  ensureTraceId(sessionId: string): string {
    return application.get('DbService').withWriteTx((tx) => {
      const [row] = tx
        .select({ traceId: sessionsTable.traceId })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, sessionId))
        .limit(1)
        .all()

      if (!row) throw DataApiErrorFactory.notFound('Session', sessionId)
      if (row.traceId) return row.traceId

      const traceId = randomBytes(16).toString('hex')
      tx.update(sessionsTable).set({ traceId }).where(eq(sessionsTable.id, sessionId)).run()
      return traceId
    })
  }

  /**
   * `pinned=true` returns a pin-owned single stream ordered by
   * `pin.orderKey ASC, session.id ASC`, independent of the session sort
   * profile. Otherwise this is the two-section page mirroring
   * `TopicService.listByCursor`: pinned sessions first, then unpinned by
   * `session.orderKey ASC, id ASC` (manual/creation drag order). A partial pin
   * page spills into the unpinned section to fill `limit`. Flat
   * creation/activity views opt into their explicit sort profiles instead.
   */
  listByCursor(query: ListAgentSessionsQuery = {}): CursorPaginationResponse<AgentSessionListItem> {
    if (query.pinned === true) {
      return this.listPinnedByCursor(query)
    }
    if (query.sortBy !== undefined) {
      return this.listFlatByCursor(query, query.sortBy)
    }
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor = decodePinnedListCursor(query.cursor, 'agent-session')
    const agentFilter = query.agentId ? eq(sessionsTable.agentId, query.agentId) : undefined

    const items: AgentSessionListItem[] = []

    if (cursor.section === 'pin') {
      const pinAfter = cursor.orderKey
        ? or(
            gt(pinTable.orderKey, cursor.orderKey),
            and(eq(pinTable.orderKey, cursor.orderKey), gt(sessionsTable.id, cursor.id))
          )
        : undefined
      const pinRows = db
        .select({
          session: sessionsTable,
          workspace: agentWorkspaceTable,
          pinId: pinTable.id,
          pinOrderKey: pinTable.orderKey
        })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .innerJoin(pinTable, and(eq(pinTable.entityType, 'session'), eq(pinTable.entityId, sessionsTable.id)))
        .where(and(agentFilter, pinAfter))
        .orderBy(asc(pinTable.orderKey), asc(sessionsTable.id))
        .limit(limit + 1)
        .all()

      // Stale pin cursor (anchor unpinned/deleted between requests) → 0 rows for
      // a non-empty `cursor.orderKey`. Hand back an entity-section-start cursor so
      // the next call advances cleanly instead of restarting the pin section.
      if (pinRows.length === 0 && cursor.orderKey !== '') {
        return { items: [], nextCursor: encodeEntitySectionStart() }
      }

      const hasMoreInPin = pinRows.length > limit
      for (const row of pinRows.slice(0, limit)) {
        items.push(toAgentSessionListItem(rowToSession(row), row.pinId))
      }

      if (hasMoreInPin) {
        const last = pinRows[limit - 1]
        return {
          items,
          nextCursor: encodePinCursor(last.pinOrderKey, last.session.id)
        }
      }

      if (items.length >= limit) {
        return { items, nextCursor: encodeEntitySectionStart() }
      }
    }

    // Tuple cursor `(orderKey, id)` over `ORDER BY orderKey ASC, id ASC`: the id
    // tiebreaker prevents dedup/skip across pages when two rows share an orderKey.
    const remaining = limit - items.length
    const pinnedSubquery = db.select({ id: pinTable.entityId }).from(pinTable).where(eq(pinTable.entityType, 'session'))

    let sessionAfter: SQL | undefined
    if (cursor.section === 'entity' && cursor.orderKey !== null) {
      sessionAfter = or(
        gt(sessionsTable.orderKey, cursor.orderKey),
        and(eq(sessionsTable.orderKey, cursor.orderKey), gt(sessionsTable.id, cursor.id))
      )
    }

    const sessionRows = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(and(agentFilter, notInArray(sessionsTable.id, pinnedSubquery), sessionAfter))
      .orderBy(asc(sessionsTable.orderKey), asc(sessionsTable.id))
      .limit(remaining + 1)
      .all()

    const hasMoreInSession = sessionRows.length > remaining
    for (const row of sessionRows.slice(0, remaining)) {
      items.push(toAgentSessionListItem(rowToSession(row), null))
    }

    let nextCursor: string | undefined
    if (hasMoreInSession) {
      const last = sessionRows[remaining - 1]
      nextCursor = encodeEntityCursor(last.session.orderKey, last.session.id)
    }

    return { items, nextCursor }
  }

  /**
   * Pinned-only page. Pin order is its own business order and deliberately
   * ignores `query.sortBy` when both fields are supplied.
   */
  private listPinnedByCursor(query: ListAgentSessionsQuery): CursorPaginationResponse<AgentSessionListItem> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const filters = buildSessionRecordFilters(query)
    const { where, orderBy } = keysetOrdering(pinTable.orderKey, sessionsTable.id, { major: 'asc', tie: 'asc' })
    const cursor = decodeListCursor(query.cursor, asStringKey, 'agent-sessions-pinned')
    if (cursor) filters.push(where(cursor))

    let builder = db
      .select({
        session: sessionsTable,
        workspace: agentWorkspaceTable,
        pinId: pinTable.id,
        pinOrderKey: pinTable.orderKey
      })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .innerJoin(pinTable, and(eq(pinTable.entityType, 'session'), eq(pinTable.entityId, sessionsTable.id)))
      .$dynamic()
    if (query.searchScope === 'full') {
      builder = builder.leftJoin(agentsTable, eq(sessionsTable.agentId, agentsTable.id))
    }
    const rows = builder
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(limit + 1)
      .all()

    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]

    return {
      items: pageRows.map((row) => toAgentSessionListItem(rowToSession(row), row.pinId)),
      nextCursor: hasMore ? encodeCursor(last.pinOrderKey, last.session.id) : undefined
    }
  }

  /**
   * Flat single-stream page, mirroring
   * `TopicService.listFlatByCursor`: `createdAt` → immutable creation order,
   * `updatedAt` → activity order (both `DESC, id ASC`), and `orderKey` →
   * manual order (`ASC, id ASC`), with the shared `(sortValue, id)` cursor.
   * `searchScope: 'full'` LEFT JOINs the agent table for agent-name matches.
   */
  private listFlatByCursor(
    query: ListAgentSessionsQuery,
    sortBy: AgentSessionSortBy
  ): CursorPaginationResponse<AgentSessionListItem> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)

    const filters = buildSessionRecordFilters(query)
    if (query.pinned === false) {
      const pinnedSubquery = db
        .select({ id: pinTable.entityId })
        .from(pinTable)
        .where(eq(pinTable.entityType, 'session'))
      filters.push(notInArray(sessionsTable.id, pinnedSubquery))
    }

    const isTimestampSort = sortBy === 'createdAt' || sortBy === 'updatedAt'
    const timestampColumn = sortBy === 'createdAt' ? sessionsTable.createdAt : sessionsTable.updatedAt
    const { where, orderBy } = isTimestampSort
      ? keysetOrdering(timestampColumn, sessionsTable.id, { major: 'desc', tie: 'asc' })
      : keysetOrdering(sessionsTable.orderKey, sessionsTable.id, { major: 'asc', tie: 'asc' })
    const cursor = isTimestampSort
      ? decodeListCursor(query.cursor, asNumericKey, 'agent-sessions-flat')
      : decodeListCursor(query.cursor, asStringKey, 'agent-sessions-flat')
    if (cursor) filters.push(where(cursor))

    let builder = db
      .select({
        session: sessionsTable,
        workspace: agentWorkspaceTable,
        pinId: pinTable.id
      })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .leftJoin(pinTable, and(eq(pinTable.entityType, 'session'), eq(pinTable.entityId, sessionsTable.id)))
      .$dynamic()
    if (query.searchScope === 'full') {
      builder = builder.leftJoin(agentsTable, eq(sessionsTable.agentId, agentsTable.id))
    }
    const rows = builder
      .where(and(...filters))
      .orderBy(...orderBy)
      .limit(limit + 1)
      .all()

    const hasMore = rows.length > limit
    const pageRows = rows.slice(0, limit)
    const last = pageRows[pageRows.length - 1]
    const nextCursor = hasMore
      ? encodeCursor(
          sortBy === 'createdAt'
            ? last.session.createdAt
            : sortBy === 'updatedAt'
              ? last.session.updatedAt
              : last.session.orderKey,
          last.session.id
        )
      : undefined

    return {
      items: pageRows.map((row) => toAgentSessionListItem(rowToSession(row), row.pinId)),
      nextCursor
    }
  }

  /**
   * Factual aggregation for `GET /agent-sessions/stats`,
   * mirroring `TopicService.stats`: totals include pinned rows. Stats and list
   * use independent SQLite snapshots; a subsequent refetch reconciles transient drift.
   */
  stats(query: AgentSessionStatsQuery = {}): AgentSessionStats {
    const db = application.get('DbService').getDb()
    const filters = buildSessionRecordFilters(query)
    const pinJoin = and(eq(pinTable.entityType, 'session'), eq(pinTable.entityId, sessionsTable.id))

    const byAgentRows = db
      .select({
        agentId: sessionsTable.agentId,
        count: count(),
        pinnedCount: count(pinTable.id)
      })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .leftJoin(pinTable, pinJoin)
      .where(and(...filters))
      .groupBy(sessionsTable.agentId)
      .all()

    let total = 0
    let pinnedCount = 0
    for (const row of byAgentRows) {
      total += row.count
      pinnedCount += row.pinnedCount
    }

    const result: AgentSessionStats = {
      total,
      pinnedCount,
      byAgent: byAgentRows.map((row) => ({
        agentId: row.agentId,
        count: row.count,
        pinnedCount: row.pinnedCount
      })),
      byWorkspace: []
    }

    const workspaceScopeExpr = sql<string>`CASE
      WHEN ${agentWorkspaceTable.type} = ${AGENT_WORKSPACE_TYPE.SYSTEM} THEN 'system'
      ELSE ${sessionsTable.workspaceId} END`
    result.byWorkspace = db
      .select({
        workspaceId: workspaceScopeExpr,
        count: count(),
        pinnedCount: count(pinTable.id)
      })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .leftJoin(pinTable, pinJoin)
      .where(and(...filters))
      .groupBy(workspaceScopeExpr)
      .all()

    return result
  }

  update(id: string, dto: UpdateAgentSessionDto): AgentSessionEntity {
    const patch: UpdateAgentSessionDto = {}
    if (dto.name !== undefined) {
      patch.name = dto.name
      // Name-only patches are user/manual renames. Auto-namers must opt out explicitly.
      patch.isNameManuallyEdited = dto.isNameManuallyEdited ?? true
    } else if (dto.isNameManuallyEdited !== undefined) {
      // Keep flag-only patches for repair/migration paths that need to adjust metadata.
      patch.isNameManuallyEdited = dto.isNameManuallyEdited
    }
    if (dto.description !== undefined) patch.description = dto.description
    if (dto.agentId !== undefined) patch.agentId = dto.agentId
    if (Object.keys(patch).length === 0) return this.getById(id)

    const row = withSqliteErrors(
      () => this.updateTx(application.get('DbService').getDb(), id, patch),
      defaultHandlersFor('Session', id)
    )
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return this.getById(id)
  }

  updateTx(tx: DbOrTx, id: string, patch: UpdateAgentSessionDto): SessionRow | undefined {
    const [row] = tx.update(sessionsTable).set(patch).where(eq(sessionsTable.id, id)).returning().all()
    return row
  }

  /**
   * Replace a session's workspace. Only an empty session (no messages) may
   * change its workspace; once a conversation has started the binding is
   * permanent. Lives on `PUT /agent-sessions/:id/workspace` rather than the
   * generic PATCH because it creates/deletes the backing system workspace row.
   */
  setWorkspace(id: string, source: AgentSessionWorkspaceSource): AgentSessionEntity {
    withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.setWorkspaceTx(tx, id, source)),
      defaultHandlersFor('Session', id)
    )
    return this.getById(id)
  }

  setWorkspaceTx(tx: DbOrTx, id: string, source: AgentSessionWorkspaceSource): void {
    const current = this.getJoinedSessionRowTx(tx, id)
    // The workspace binding is locked the moment a session has any message.
    this.assertSessionHasNoMessagesTx(tx, id)

    if (source.type === AGENT_WORKSPACE_TYPE.USER) {
      const workspace = agentWorkspaceService.getRowByIdTx(tx, source.workspaceId)
      if (workspace.id === current.session.workspaceId) return
      // Repoint first, then drop the old system workspace so the session FK never dangles.
      tx.update(sessionsTable).set({ workspaceId: workspace.id }).where(eq(sessionsTable.id, id)).run()
      if (current.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM) {
        agentWorkspaceService.deleteByIdTx(tx, current.session.workspaceId)
      }
      return
    }

    // Target is a system workspace; an existing system workspace is already correct.
    if (current.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM) return
    const workspace = agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: id })
    tx.update(sessionsTable).set({ workspaceId: workspace.id }).where(eq(sessionsTable.id, id)).run()
  }

  private getJoinedSessionRowTx(tx: DbOrTx, id: string): JoinedSessionRow {
    const [row] = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return row
  }

  private assertSessionHasNoMessagesTx(tx: DbOrTx, sessionId: string): void {
    const [message] = tx
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(eq(agentSessionMessageTable.sessionId, sessionId))
      .limit(1)
      .all()
    if (message) {
      throw DataApiErrorFactory.invalidOperation(
        'update session workspace',
        'workspace cannot be changed after messages are sent'
      )
    }
  }

  private insertTx(
    tx: DbOrTx,
    values: {
      id: string
      agentId: string
      name: string
      description?: string
      workspaceId: string
    }
  ): void {
    insertWithOrderKey(tx, sessionsTable, values, { pkColumn: sessionsTable.id, position: 'first' })
  }

  delete(id: string): void {
    application.get('DbService').withWriteTx((tx) => this.deleteTx(tx, id))
  }

  deleteTx(tx: DbOrTx, id: string): void {
    const [row] = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)

    this.cascadeDeleteSessionRowsTx(tx, [row])
  }

  deleteByIds(ids: string[]): DeleteAgentSessionsResult {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return { deletedIds: [] }

    const deletedIds = application.get('DbService').withWriteTx((tx) => {
      const rows = tx
        .select({ session: sessionsTable, workspace: agentWorkspaceTable })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(inArray(sessionsTable.id, uniqueIds))
        .all()

      return this.cascadeDeleteSessionRowsTx(tx, rows)
    })

    logger.info('Deleted sessions', { count: deletedIds.length })
    return { deletedIds }
  }

  deleteWorkspaceCascade(workspaceId: string): DeleteAgentSessionsResult {
    const deletedIds = application.get('DbService').withWriteTx((tx) => {
      agentWorkspaceService.getRowByIdTx(tx, workspaceId)
      const deletedIds = this.deleteByWorkspaceTx(tx, workspaceId)
      agentWorkspaceService.deleteByIdTx(tx, workspaceId)
      return deletedIds
    })
    return { deletedIds }
  }

  deleteByWorkspaceTx(tx: DbOrTx, workspaceId: string): string[] {
    const deletedSessions = tx
      .delete(sessionsTable)
      .where(eq(sessionsTable.workspaceId, workspaceId))
      .returning({ id: sessionsTable.id })
      .all()
    const sessionIds = deletedSessions.map((session) => session.id)
    pinService.purgeForEntitiesTx(tx, 'session', sessionIds)
    return sessionIds
  }

  deleteByAgentId(agentId: string): DeleteAgentSessionsResult {
    const deletedIds = application.get('DbService').withWriteTx((tx) => this.deleteByAgentIdTx(tx, agentId))

    logger.info('Deleted agent sessions', { agentId, count: deletedIds.length })
    return { deletedIds }
  }

  deleteByAgentIdTx(tx: DbOrTx, agentId: string, options: { validateAgent?: boolean } = {}): string[] {
    if (options.validateAgent ?? true) {
      const [agent] = tx
        .select({ id: agentsTable.id })
        .from(agentsTable)
        .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
        .limit(1)
        .all()
      if (!agent) throw DataApiErrorFactory.notFound('Agent', agentId)
    }

    const rows = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.agentId, agentId))
      .all()

    return this.cascadeDeleteSessionRowsTx(tx, rows)
  }

  private cascadeDeleteSessionRowsTx(tx: DbOrTx, rows: JoinedSessionRow[]): string[] {
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

    const deleted = new Set(this.deleteByIdsTx(tx, normalSessionIds))
    for (const workspaceId of systemWorkspaceIds) {
      const workspaceSessionIds = this.deleteByWorkspaceTx(tx, workspaceId)
      for (const id of workspaceSessionIds) {
        deleted.add(id)
      }
      agentWorkspaceService.deleteByIdTx(tx, workspaceId)
    }

    return Array.from(deleted)
  }

  private deleteByIdsTx(tx: DbOrTx, ids: string[]): string[] {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = tx
      .delete(sessionsTable)
      .where(inArray(sessionsTable.id, uniqueIds))
      .returning({
        id: sessionsTable.id
      })
      .all()
    const deletedIds = rows.map((row) => row.id)

    pinService.purgeForEntitiesTx(tx, 'session', deletedIds)
    return deletedIds
  }

  reorder(id: string, anchor: OrderRequest): void {
    application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
  }

  reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): void {
    const [target] = tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1)
      .all()
    if (!target) throw DataApiErrorFactory.notFound('Session', id)

    applyMoves(tx, sessionsTable, [{ id, anchor }], { pkColumn: sessionsTable.id })
  }

  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
  }

  reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): void {
    applyMoves(tx, sessionsTable, moves, { pkColumn: sessionsTable.id })
  }

  exists(id: string): boolean {
    const db = application.get('DbService').getDb()
    const [row] = db.select({ id: sessionsTable.id }).from(sessionsTable).where(eq(sessionsTable.id, id)).limit(1).all()
    return !!row
  }
}

export const agentSessionService = new AgentSessionService()
