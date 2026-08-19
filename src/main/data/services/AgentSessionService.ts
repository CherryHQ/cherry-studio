import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentWorkspaceService, rowToAgentWorkspace } from '@data/services/AgentWorkspaceService'
import { getDataService } from '@data/services/dataServiceRegistry'
import { pinService } from '@data/services/PinService'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { buildSearchSnippet } from '@main/utils/searchSnippet'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type {
  AgentSessionEntity,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  LatestAgentSessionQuery,
  ListAgentSessionsQuery,
  ReusableAgentSessionPlaceholdersResponse,
  ReuseOrCreateAgentSessionDto,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type { CursorPaginationResponse, DataApiDataChangeEffect } from '@shared/data/api/types'
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'

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
export type SessionMetadataSearchMatch = {
  field: 'name' | 'description'
  snippet: string
}

export type SessionMetadataSearchResult = {
  item: SessionEntitySearchItem
  matches: SessionMetadataSearchMatch[]
}

export type AddressableAgentSession = {
  agentId: string
  agentName: string
  sessionId: string
  sessionName: string
}

function publishTaskReadModelChanges(taskIds: readonly string[]): void {
  if (taskIds.length === 0) return
  // Resolve lazily because AgentTaskService reads the Session-owned relation.
  getDataService('AgentTaskService').notifyReadModelChange(taskIds)
}

type JoinedSessionRow = {
  session: SessionRow
  workspace: AgentWorkspaceRow
}

export type AgentSessionDeletionOutcome = {
  deletedIds: string[]
  taskScheduleIds: string[]
  deliveryResults: AgentSessionMessageEntity[]
}

export type ReuseOrCreateAgentSessionOutcome = ReusableAgentSessionPlaceholdersResponse & {
  deliveryResults: AgentSessionMessageEntity[]
}

function rowToSession(row: JoinedSessionRow): AgentSessionEntity {
  const clean = nullsToUndefined(row.session)
  return {
    id: clean.id,
    // agentId is legitimately nullable (orphans only via cascade) — preserve T | null.
    agentId: row.session.agentId,
    name: clean.name,
    isNameManuallyEdited: clean.isNameManuallyEdited,
    description: clean.description,
    workspaceId: clean.workspaceId,
    workspace: rowToAgentWorkspace(row.workspace),
    traceId: clean.traceId,
    orderKey: clean.orderKey,
    lastActivityAt: timestampToISO(row.session.lastActivityAt),
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

export function agentSessionReadModelEffects(
  sessionIds: readonly string[],
  kind: 'membership' | 'projection'
): DataApiDataChangeEffect[] {
  if (sessionIds.length === 0) return []
  const entityIds = [...new Set(sessionIds)]
  return [
    { endpoint: '/agent-sessions', kind, entityIds },
    { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds },
    { endpoint: '/agent-sessions/:sessionId', entityIds },
    { endpoint: '/agent-sessions/latest' }
  ]
}

export class AgentSessionService {
  notifyReadModelChange(sessionIds: readonly string[], kind: 'membership' | 'projection'): void {
    const effects = agentSessionReadModelEffects(sessionIds, kind)
    if (effects.length > 0) notifyDataApiDataChange(effects)
  }

  listAddressableByCursor(query: {
    agentId?: string
    cursor?: string
    limit?: number
  }): CursorPaginationResponse<AddressableAgentSession> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), 100)
    const filters = [isNull(agentsTable.deletedAt)]
    if (query.agentId) filters.push(eq(sessionsTable.agentId, query.agentId))
    if (query.cursor) filters.push(gt(sessionsTable.id, query.cursor))
    const rows = application
      .get('DbService')
      .getDb()
      .select({
        agentId: agentsTable.id,
        agentName: agentsTable.name,
        sessionId: sessionsTable.id,
        sessionName: sessionsTable.name
      })
      .from(sessionsTable)
      .innerJoin(agentsTable, eq(sessionsTable.agentId, agentsTable.id))
      .where(and(...filters))
      .orderBy(asc(sessionsTable.id))
      .limit(limit + 1)
      .all()
    const hasNext = rows.length > limit
    const items = hasNext ? rows.slice(0, limit) : rows
    return { items, nextCursor: hasNext ? items.at(-1)?.sessionId : undefined }
  }

  search(query: { q: string; limit: number; updatedAtFrom?: number; agentId?: string }): SessionEntitySearchItem[] {
    return this.searchWithMetadataEvidence(query).map((result) => result.item)
  }

  searchWithMetadataEvidence(query: {
    q: string
    limit: number
    updatedAtFrom?: number
    agentId?: string
    addressableOnly?: boolean
  }): SessionMetadataSearchResult[] {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit, MAX_LIMIT)
    const filters: SQL[] = []
    const search = buildSearchPredicate(query.q)
    if (search) filters.push(search)
    if (query.agentId) filters.push(eq(sessionsTable.agentId, query.agentId))
    if (query.addressableOnly) filters.push(isNotNull(agentsTable.id))
    if (query.updatedAtFrom !== undefined) {
      filters.push(gte(sessionsTable.updatedAt, query.updatedAtFrom))
    }

    const rows = db
      .select({
        id: sessionsTable.id,
        agentId: sessionsTable.agentId,
        agentName: agentsTable.name,
        name: sessionsTable.name,
        description: sessionsTable.description,
        lastActivityAt: sessionsTable.lastActivityAt
      })
      .from(sessionsTable)
      .leftJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(sessionsTable.lastActivityAt), asc(sessionsTable.id))
      .limit(limit)
      .all()

    const searchTerm = query.q.trim()
    const normalizedQuery = searchTerm.toLocaleLowerCase()
    return rows.map((row) => {
      const matches: SessionMetadataSearchMatch[] = []
      if (searchTerm && row.name.toLocaleLowerCase().includes(normalizedQuery)) {
        matches.push({ field: 'name', snippet: buildSearchSnippet(row.name, [searchTerm], 'substring') })
      }
      if (searchTerm && row.description?.toLocaleLowerCase().includes(normalizedQuery)) {
        matches.push({
          field: 'description',
          snippet: buildSearchSnippet(row.description, [searchTerm], 'substring')
        })
      }
      return {
        item: {
          type: 'session',
          id: row.id,
          title: row.name,
          subtitle: row.agentName ?? undefined,
          lastActivityAt: timestampToISO(row.lastActivityAt),
          target: { sessionId: row.id, agentId: row.agentId }
        },
        matches
      }
    })
  }

  create(dto: CreateAgentSessionDto): AgentSessionEntity {
    const id = uuidv4()
    withSqliteErrors(() => application.get('DbService').withWriteTx((tx) => this.createTx(tx, id, dto)), {
      ...defaultHandlersFor('Session', id),
      foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
    })
    this.notifyReadModelChange([id], 'membership')
    return this.getById(id)
  }

  /**
   * DB-only create primitive for caller-owned transaction composition.
   * The caller supplies the reserved id and owns the outer commit boundary.
   */
  createTx(tx: DbOrTx, id: string, dto: CreateAgentSessionDto): void {
    this.assertAgentExistsTx(tx, dto.agentId)
    const createdAt = Date.now()

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
        workspaceId = agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, { sessionId: id, createdAt }).id
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
      workspaceId,
      createdAt,
      updatedAt: createdAt
    })
  }

  /** Bump metadata modification time from a foreign service's transaction. */
  touchUpdatedAtTx(tx: DbOrTx, sessionId: string, timestampMs: number): void {
    tx.update(sessionsTable).set({ updatedAt: timestampMs }).where(eq(sessionsTable.id, sessionId)).run()
  }

  /** Monotonically advance a session's activity time within the caller's write transaction. */
  advanceLastActivityAtTx(tx: DbOrTx, sessionId: string, timestamp: number): void {
    const updated = tx
      .update(sessionsTable)
      .set({
        lastActivityAt: sql`max(${sessionsTable.lastActivityAt}, ${timestamp})`,
        updatedAt: sql`max(${sessionsTable.updatedAt}, ${timestamp})`
      })
      .where(eq(sessionsTable.id, sessionId))
      .returning({ id: sessionsTable.id })
      .all()
    if (updated.length !== 1) throw DataApiErrorFactory.notFound('Session', sessionId)
  }

  private assertAgentExistsTx(tx: DbOrTx, agentId: string): void {
    const [agent] = tx
      .select({ id: agentsTable.id })
      .from(agentsTable)
      .where(and(eq(agentsTable.id, agentId), isNull(agentsTable.deletedAt)))
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

  /** Read the internal sticky-session relation without exposing it on session entities. */
  getByTaskScheduleId(taskScheduleId: string): AgentSessionEntity | null {
    return this.getByTaskScheduleIdTx(application.get('DbService').getDb(), taskScheduleId)
  }

  getByTaskScheduleIdTx(tx: DbOrTx, taskScheduleId: string): AgentSessionEntity | null {
    const [row] = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.taskScheduleId, taskScheduleId))
      .limit(1)
      .all()
    return row ? rowToSession(row) : null
  }

  /** Batch relation read for task list projections. */
  getTaskSessionIdsByScheduleIds(taskScheduleIds: readonly string[]): Map<string, string> {
    return this.getTaskSessionIdsByScheduleIdsTx(application.get('DbService').getDb(), taskScheduleIds)
  }

  getTaskSessionIdsByScheduleIdsTx(tx: DbOrTx, taskScheduleIds: readonly string[]): Map<string, string> {
    if (taskScheduleIds.length === 0) return new Map()
    const rows = tx
      .select({ taskScheduleId: sessionsTable.taskScheduleId, sessionId: sessionsTable.id })
      .from(sessionsTable)
      .where(inArray(sessionsTable.taskScheduleId, [...new Set(taskScheduleIds)]))
      .all()
    return new Map(rows.flatMap((row) => (row.taskScheduleId ? [[row.taskScheduleId, row.sessionId] as const] : [])))
  }

  /**
   * Bind an unbound session to an unbound task schedule. The task command owner
   * validates schedule type/configuration; this table owner validates session ownership.
   */
  bindTaskScheduleTx(
    tx: DbOrTx,
    params: { sessionId: string; taskScheduleId: string; expectedAgentId: string }
  ): boolean {
    const [session] = tx
      .select({ agentId: sessionsTable.agentId, taskScheduleId: sessionsTable.taskScheduleId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, params.sessionId))
      .limit(1)
      .all()
    if (!session) throw DataApiErrorFactory.notFound('Session', params.sessionId)
    if (session.agentId !== params.expectedAgentId) return false
    if (session.taskScheduleId !== null) return false

    const alreadyBound = tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.taskScheduleId, params.taskScheduleId))
      .limit(1)
      .all()
    if (alreadyBound.length > 0) return false

    return this.updateTaskScheduleRelationTx(
      tx,
      params.taskScheduleId,
      and(eq(sessionsTable.id, params.sessionId), isNull(sessionsTable.taskScheduleId))!
    )
  }

  clearTaskScheduleTx(tx: DbOrTx, taskScheduleId: string): boolean {
    return this.updateTaskScheduleRelationTx(tx, null, eq(sessionsTable.taskScheduleId, taskScheduleId))
  }

  /** Prepare session-owned changes before the caller deletes an agent row. */
  prepareForAgentDeletionTx(
    tx: DbOrTx,
    agentId: string,
    options: { deleteSessions: boolean }
  ): {
    sessionIds: string[]
    taskScheduleIds: string[]
    changeKind: 'membership' | 'projection'
    deliveryResults: AgentSessionMessageEntity[]
  } {
    const sessions = tx
      .select({ id: sessionsTable.id, taskScheduleId: sessionsTable.taskScheduleId })
      .from(sessionsTable)
      .where(eq(sessionsTable.agentId, agentId))
      .all()
    const taskScheduleIds = sessions.flatMap((session) => (session.taskScheduleId ? [session.taskScheduleId] : []))

    if (options.deleteSessions) {
      const deliveryResults: AgentSessionMessageEntity[] = []
      return {
        sessionIds: this.deleteByAgentIdTx(tx, agentId, { validateAgent: false, deliveryResults }),
        taskScheduleIds,
        changeKind: 'membership',
        deliveryResults
      }
    }

    if (taskScheduleIds.length > 0) {
      this.updateTaskScheduleRelationTx(
        tx,
        null,
        and(eq(sessionsTable.agentId, agentId), isNotNull(sessionsTable.taskScheduleId))!
      )
    }
    const sessionIds = sessions.map((session) => session.id)
    return {
      sessionIds,
      taskScheduleIds,
      changeKind: 'projection',
      deliveryResults: getDataService('AgentSessionMessageService').prepareRetainedSessionAgentDeletionTx(
        tx,
        sessionIds
      )
    }
  }

  /** Relation maintenance is not session activity and must not affect recency restore. */
  private updateTaskScheduleRelationTx(tx: DbOrTx, taskScheduleId: string | null, where: SQL): boolean {
    return (
      tx
        .update(sessionsTable)
        // Explicit self-assignment suppresses updatedAt's table-level $onUpdateFn.
        .set({ taskScheduleId, updatedAt: sql`${sessionsTable.updatedAt}` })
        .where(where)
        .run().changes > 0
    )
  }

  /**
   * The single most-recently-active session, or `null` when there are none.
   *
   * First-entry restore resumes the last-touched session. It cannot read the
   * regular first page of `listByCursor` for this: that pages pinned-first then
   * by `orderKey ASC` (creation/manual order, newest-created first), so a
   * recently-active session is not guaranteed to be on it. This
   * `lastActivityAt DESC LIMIT 1` proves global latest independent of the rail's ordering.
   */
  getLatestActive(query: LatestAgentSessionQuery = {}): AgentSessionEntity | null {
    const db = application.get('DbService').getDb()
    const ownerFilter =
      query.agentId === 'unlinked'
        ? isNull(agentsTable.id)
        : query.agentId
          ? eq(agentsTable.id, query.agentId)
          : undefined
    const [row] = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .leftJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
      .where(ownerFilter)
      .orderBy(desc(sessionsTable.lastActivityAt), asc(sessionsTable.id))
      .limit(1)
      .all()
    return row ? rowToSession(row) : null
  }

  /** Reuse or create one exact empty placeholder under a serialized write transaction. */
  reuseOrCreatePlaceholderForDelivery(dto: ReuseOrCreateAgentSessionDto): ReuseOrCreateAgentSessionOutcome {
    const reservedId = uuidv4()
    const result = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          this.assertAgentExistsTx(tx, dto.agentId)

          const workspaceFilter = (() => {
            if (dto.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM) {
              return eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.SYSTEM)
            }

            const workspace = agentWorkspaceService.getByIdTx(tx, dto.workspace.workspaceId, { includeSystem: true })
            if (workspace.type !== AGENT_WORKSPACE_TYPE.USER) {
              throw DataApiErrorFactory.invalidOperation(
                'reuse or create session',
                'workspace source must reference a user workspace'
              )
            }
            return and(
              eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.USER),
              eq(sessionsTable.workspaceId, workspace.id)
            )
          })()

          const reusableRows = tx
            .select({ session: sessionsTable, workspace: agentWorkspaceTable })
            .from(sessionsTable)
            .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
            .where(
              and(
                eq(sessionsTable.agentId, dto.agentId),
                workspaceFilter,
                dto.excludeSessionId ? notInArray(sessionsTable.id, [dto.excludeSessionId]) : undefined,
                eq(sessionsTable.isNameManuallyEdited, false),
                sql`trim(${sessionsTable.name}) = ''`,
                sql`NOT EXISTS (
                  SELECT 1
                  FROM ${agentSessionMessageTable}
                  WHERE ${agentSessionMessageTable.sessionId} = ${sessionsTable.id}
                )`
              )
            )
            .orderBy(desc(sessionsTable.updatedAt), asc(sessionsTable.id))
            .all()

          const reusable = reusableRows[0]
          if (reusable) {
            const duplicateDeletion =
              dto.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM
                ? this.cascadeDeleteSessionRowsTx(tx, reusableRows.slice(1))
                : { deletedIds: [], taskScheduleIds: [], deliveryResults: [] }
            return {
              session: rowToSession(reusable),
              created: false,
              deletedDuplicateSessionIds: duplicateDeletion.deletedIds,
              taskScheduleIds: duplicateDeletion.taskScheduleIds,
              deliveryResults: duplicateDeletion.deliveryResults
            }
          }

          this.createTx(tx, reservedId, {
            agentId: dto.agentId,
            name: '',
            workspace: dto.workspace
          })
          const [created] = tx
            .select({ session: sessionsTable, workspace: agentWorkspaceTable })
            .from(sessionsTable)
            .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
            .where(eq(sessionsTable.id, reservedId))
            .limit(1)
            .all()
          if (!created) throw DataApiErrorFactory.notFound('Session', reservedId)

          return {
            session: rowToSession(created),
            created: true,
            deletedDuplicateSessionIds: [],
            taskScheduleIds: [],
            deliveryResults: []
          }
        }),
      {
        ...defaultHandlersFor('Session', reservedId),
        foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
      }
    )

    publishTaskReadModelChanges(result.taskScheduleIds)
    this.notifyReadModelChange(
      [...(result.created ? [result.session.id] : []), ...result.deletedDuplicateSessionIds],
      'membership'
    )
    getDataService('AgentSessionMessageService').publishDeliveryChanges(result.deliveryResults)
    if (result.deletedDuplicateSessionIds.length > 0) pinService.notifyPurged()
    return {
      session: result.session,
      created: result.created,
      deletedDuplicateSessionIds: result.deletedDuplicateSessionIds,
      deliveryResults: result.deliveryResults
    }
  }

  ensureTraceId(sessionId: string): string {
    return application.get('DbService').withWriteTx((tx) => this.ensureTraceIdTx(tx, sessionId))
  }

  ensureTraceIdTx(tx: DbOrTx, sessionId: string): string {
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
  }

  /**
   * Two-section page mirroring `TopicService.listByCursor`: pinned sessions
   * first (via the shared `pin` table, ordered by `pin.orderKey`) then unpinned
   * by `session.orderKey ASC, id ASC` (manual/creation drag order). A partial
   * pin page spills into the unpinned section to fill `limit`. Pins float a
   * session to the top independent of its own `orderKey`, so both rails share
   * one pagination contract; recency ordering for the time-grouped view is
   * applied by the renderer over the loaded list.
   */
  listByCursor(query: ListAgentSessionsQuery = {}): CursorPaginationResponse<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor = decodePinnedListCursor(query.cursor, 'agent-session')
    const agentFilter = query.agentId ? eq(sessionsTable.agentId, query.agentId) : undefined

    const items: Array<{ session: AgentSessionEntity; pinOrderKey?: string }> = []

    if (cursor.section === 'pin') {
      const pinAfter = cursor.orderKey
        ? or(
            gt(pinTable.orderKey, cursor.orderKey),
            and(eq(pinTable.orderKey, cursor.orderKey), gt(sessionsTable.id, cursor.id))
          )
        : undefined
      const pinRows = db
        .select({ session: sessionsTable, workspace: agentWorkspaceTable, pinOrderKey: pinTable.orderKey })
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
        items.push({ session: rowToSession(row), pinOrderKey: row.pinOrderKey })
      }

      if (hasMoreInPin) {
        const last = items[items.length - 1]
        return {
          items: items.map((i) => i.session),
          nextCursor: encodePinCursor(last.pinOrderKey ?? '', last.session.id)
        }
      }

      if (items.length >= limit) {
        return { items: items.map((i) => i.session), nextCursor: encodeEntitySectionStart() }
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
      items.push({ session: rowToSession(row) })
    }

    let nextCursor: string | undefined
    if (hasMoreInSession) {
      const last = sessionRows[remaining - 1]
      nextCursor = encodeEntityCursor(last.session.orderKey, last.session.id)
    }

    return { items: items.map((i) => i.session), nextCursor }
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

    const result = withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.updateTx(tx, id, patch)),
      defaultHandlersFor('Session', id)
    )
    if (!result.row) throw DataApiErrorFactory.notFound('Session', id)
    publishTaskReadModelChanges(result.clearedTaskScheduleIds)
    this.notifyReadModelChange([id], 'projection')
    return this.getById(id)
  }

  updateTx(
    tx: DbOrTx,
    id: string,
    patch: UpdateAgentSessionDto
  ): { row: SessionRow | undefined; clearedTaskScheduleIds: string[] } {
    const [current] = tx
      .select({ agentId: sessionsTable.agentId, taskScheduleId: sessionsTable.taskScheduleId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .limit(1)
      .all()
    if (!current) return { row: undefined, clearedTaskScheduleIds: [] }

    const reassigned = patch.agentId !== undefined && patch.agentId !== current.agentId
    const clearedTaskScheduleIds = reassigned && current.taskScheduleId ? [current.taskScheduleId] : []
    if (reassigned && current.taskScheduleId) {
      this.updateTaskScheduleRelationTx(tx, null, eq(sessionsTable.id, id))
    }
    const [row] = tx.update(sessionsTable).set(patch).where(eq(sessionsTable.id, id)).returning().all()
    return { row, clearedTaskScheduleIds }
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
    this.notifyReadModelChange([id], 'projection')
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
    const workspace = agentWorkspaceService.createSystemWorkspaceForSessionTx(tx, {
      sessionId: id,
      createdAt: current.session.createdAt
    })
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
      createdAt: number
      updatedAt: number
    }
  ): void {
    insertWithOrderKey(
      tx,
      sessionsTable,
      { ...values, lastActivityAt: values.createdAt },
      {
        pkColumn: sessionsTable.id,
        position: 'first'
      }
    )
  }

  delete(id: string): void {
    this.deleteForDelivery(id)
  }

  deleteForDelivery(id: string): AgentSessionDeletionOutcome {
    const result = application.get('DbService').withWriteTx((tx) => {
      const row = this.getJoinedSessionRowTx(tx, id)
      return this.cascadeDeleteSessionRowsTx(tx, [row])
    })
    publishTaskReadModelChanges(result.taskScheduleIds)
    getDataService('AgentSessionMessageService').publishDeliveryChanges(result.deliveryResults)
    this.notifyReadModelChange(result.deletedIds, 'membership')
    if (result.deletedIds.length > 0) pinService.notifyPurged()
    return result
  }

  deleteTx(tx: DbOrTx, id: string): string[] {
    const [row] = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)

    return this.cascadeDeleteSessionRowsTx(tx, [row]).taskScheduleIds
  }

  deleteByIds(ids: string[]): DeleteAgentSessionsResult {
    const result = this.deleteByIdsForDelivery(ids)
    return { deletedIds: result.deletedIds }
  }

  deleteByIdsForDelivery(ids: string[]): AgentSessionDeletionOutcome {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return { deletedIds: [], taskScheduleIds: [], deliveryResults: [] }

    const result = application.get('DbService').withWriteTx((tx) => {
      const rows = tx
        .select({ session: sessionsTable, workspace: agentWorkspaceTable })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(inArray(sessionsTable.id, uniqueIds))
        .all()

      return this.cascadeDeleteSessionRowsTx(tx, rows)
    })

    publishTaskReadModelChanges(result.taskScheduleIds)
    getDataService('AgentSessionMessageService').publishDeliveryChanges(result.deliveryResults)
    this.notifyReadModelChange(result.deletedIds, 'membership')
    if (result.deletedIds.length > 0) pinService.notifyPurged()
    logger.info('Deleted sessions', { count: result.deletedIds.length })
    return result
  }

  deleteWorkspaceCascade(workspaceId: string): DeleteAgentSessionsResult {
    const result = this.deleteWorkspaceCascadeForDelivery(workspaceId)
    return { deletedIds: result.deletedIds }
  }

  deleteWorkspaceCascadeForDelivery(workspaceId: string): AgentSessionDeletionOutcome {
    const result = application.get('DbService').withWriteTx((tx) => {
      agentWorkspaceService.getRowByIdTx(tx, workspaceId)
      const channelReferences = agentChannelService.resetWorkspaceReferencesTx(tx, workspaceId)
      const taskReferences = getDataService('AgentTaskService').resetWorkspaceReferencesTx(tx, workspaceId)
      const taskScheduleIds = this.getTaskScheduleIdsForWorkspaceTx(tx, workspaceId)
      const sessionIds = tx
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(eq(sessionsTable.workspaceId, workspaceId))
        .all()
        .map((session) => session.id)
      const deliveryResults = getDataService('AgentSessionMessageService').prepareSessionDeletionTx(tx, sessionIds)
      const deletedIds = this.deleteByWorkspaceTx(tx, workspaceId)
      agentWorkspaceService.deleteByIdTx(tx, workspaceId)
      return { deletedIds, taskScheduleIds, channelReferences, taskReferences, deliveryResults }
    })
    publishTaskReadModelChanges([...result.taskScheduleIds, ...result.taskReferences.map((task) => task.id)])
    this.notifyReadModelChange(result.deletedIds, 'membership')
    if (result.deletedIds.length > 0) pinService.notifyPurged()
    logger.info('Deleted user workspace', {
      workspaceId,
      deletedSessionCount: result.deletedIds.length,
      resetChannelCount: result.channelReferences.length,
      resetTaskCount: result.taskReferences.length
    })
    getDataService('AgentSessionMessageService').publishDeliveryChanges(result.deliveryResults)
    return {
      deletedIds: result.deletedIds,
      taskScheduleIds: result.taskScheduleIds,
      deliveryResults: result.deliveryResults
    }
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
    const result = this.deleteByAgentIdForDelivery(agentId)
    return { deletedIds: result.deletedIds }
  }

  deleteByAgentIdForDelivery(agentId: string): AgentSessionDeletionOutcome {
    const deliveryResults: AgentSessionMessageEntity[] = []
    const result = application.get('DbService').withWriteTx((tx) => {
      const taskScheduleIds = this.getTaskScheduleIdsForAgentTx(tx, agentId)
      const deletedIds = this.deleteByAgentIdTx(tx, agentId, { deliveryResults })
      return { deletedIds, taskScheduleIds, deliveryResults }
    })

    publishTaskReadModelChanges(result.taskScheduleIds)
    getDataService('AgentSessionMessageService').publishDeliveryChanges(result.deliveryResults)
    this.notifyReadModelChange(result.deletedIds, 'membership')
    if (result.deletedIds.length > 0) pinService.notifyPurged()
    logger.info('Deleted agent sessions', { agentId, count: result.deletedIds.length })
    return result
  }

  deleteByAgentIdTx(
    tx: DbOrTx,
    agentId: string,
    options: { validateAgent?: boolean; deliveryResults?: AgentSessionMessageEntity[] } = {}
  ): string[] {
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

    const result = this.cascadeDeleteSessionRowsTx(tx, rows)
    options.deliveryResults?.push(...result.deliveryResults)
    return result.deletedIds
  }

  listIdsByAgentTx(tx: DbOrTx, agentId: string): string[] {
    return tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.agentId, agentId))
      .all()
      .map((row) => row.id)
  }

  private cascadeDeleteSessionRowsTx(tx: DbOrTx, rows: JoinedSessionRow[]): AgentSessionDeletionOutcome {
    const deliveryResults = getDataService('AgentSessionMessageService').prepareSessionDeletionTx(
      tx,
      rows.map((row) => row.session.id)
    )
    const taskScheduleIds = this.getTaskScheduleIdsForSessionIdsTx(
      tx,
      rows.map((row) => row.session.id)
    )
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

    return { deletedIds: Array.from(deleted), taskScheduleIds, deliveryResults }
  }

  private getTaskScheduleIdsForSessionIdsTx(tx: DbOrTx, sessionIds: readonly string[]): string[] {
    if (sessionIds.length === 0) return []
    return tx
      .select({ taskScheduleId: sessionsTable.taskScheduleId })
      .from(sessionsTable)
      .where(and(inArray(sessionsTable.id, [...new Set(sessionIds)]), isNotNull(sessionsTable.taskScheduleId)))
      .all()
      .flatMap((row) => (row.taskScheduleId ? [row.taskScheduleId] : []))
  }

  private getTaskScheduleIdsForWorkspaceTx(tx: DbOrTx, workspaceId: string): string[] {
    return tx
      .select({ taskScheduleId: sessionsTable.taskScheduleId })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.workspaceId, workspaceId), isNotNull(sessionsTable.taskScheduleId)))
      .all()
      .flatMap((row) => (row.taskScheduleId ? [row.taskScheduleId] : []))
  }

  getTaskScheduleIdsForAgentTx(tx: DbOrTx, agentId: string): string[] {
    return tx
      .select({ taskScheduleId: sessionsTable.taskScheduleId })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.agentId, agentId), isNotNull(sessionsTable.taskScheduleId)))
      .all()
      .flatMap((row) => (row.taskScheduleId ? [row.taskScheduleId] : []))
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
}

export const agentSessionService = new AgentSessionService()
