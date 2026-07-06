import { randomBytes } from 'node:crypto'

import { application } from '@application'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { type AgentSessionRow as SessionRow, agentSessionTable as sessionsTable } from '@data/db/schemas/agentSession'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
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
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  ListAgentSessionsQuery,
  RestoreAgentSessionsResult,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, lt, or, type SQL, sql } from 'drizzle-orm'
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
    updatedAt: timestampToISO(row.session.updatedAt),
    // Read-only trash marker: present only on soft-deleted rows (trash
    // listings). Never writable through DTOs.
    deletedAt: row.session.deletedAt != null ? timestampToISO(row.session.deletedAt) : undefined
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
  search(query: { q: string; limit: number; updatedAtFrom?: number }): SessionEntitySearchItem[] {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit, MAX_LIMIT)
    const filters: SQL[] = [isNull(sessionsTable.deletedAt)]
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
      .where(and(...filters))
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

  private createTx(tx: DbOrTx, id: string, dto: CreateAgentSessionDto): void {
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
    // Archived agents are hidden from reads, so new sessions cannot be
    // created under them either.
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
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
      .limit(1)
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return rowToSession(row)
  }

  ensureTraceId(sessionId: string): string {
    return application.get('DbService').withWriteTx((tx) => {
      const [row] = tx
        .select({ traceId: sessionsTable.traceId })
        .from(sessionsTable)
        .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.deletedAt)))
        .limit(1)
        .all()

      if (!row) throw DataApiErrorFactory.notFound('Session', sessionId)
      if (row.traceId) return row.traceId

      const traceId = randomBytes(16).toString('hex')
      tx.update(sessionsTable).set({ traceId }).where(eq(sessionsTable.id, sessionId)).run()
      return traceId
    })
  }

  listByCursor(query: ListAgentSessionsQuery = {}): CursorPaginationResponse<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const ordering = keysetOrdering(sessionsTable.orderKey, sessionsTable.id, { major: 'asc', tie: 'asc' })
    const cursor = decodeListCursor(query.cursor, asStringKey, 'agent-session')

    // `inTrash: true` flips the liveness filter to show only trashed rows;
    // cursor/agent filters compose unchanged.
    const filters: SQL[] = [
      query.inTrash === true ? isNotNull(sessionsTable.deletedAt) : isNull(sessionsTable.deletedAt)
    ]
    if (query.agentId) filters.push(eq(sessionsTable.agentId, query.agentId))
    if (cursor) {
      filters.push(ordering.where(cursor))
    }

    const rows = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()

    const hasNext = rows.length > limit
    const items = (hasNext ? rows.slice(0, limit) : rows).map(rowToSession)
    const last = items[items.length - 1]
    const nextCursor = hasNext && last ? encodeCursor(last.orderKey, last.id) : undefined

    return { items, nextCursor }
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
    const [row] = tx
      .update(sessionsTable)
      .set(patch)
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
      .returning()
      .all()
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
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
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

  /**
   * Delete one session.
   *
   * Default (archive) path: soft-delete — sets `deletedAt` so the row lands
   * in the trash and is restorable via {@link restore}. Session pins are
   * purged at archive time; session messages and the backing workspace row
   * (including a system workspace) are untouched so restore is lossless.
   *
   * `permanent: true`: hard-delete via the cascade path — session messages
   * FK-cascade, pins are purged, and a backing system workspace row is
   * removed. Works on both active and already-trashed rows.
   */
  delete(id: string, options: { permanent?: boolean } = {}): void {
    application.get('DbService').withWriteTx((tx) => this.deleteTx(tx, id, options))
  }

  deleteTx(tx: DbOrTx, id: string, options: { permanent?: boolean } = {}): void {
    // No isNull gate: trashed rows must be permanently deletable, and
    // re-archiving an archived row is an idempotent no-op.
    const [row] = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(eq(sessionsTable.id, id))
      .limit(1)
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)

    if (options.permanent === true) {
      this.cascadeDeleteSessionRowsTx(tx, [row])
    } else {
      this.archiveByIdsTx(tx, [id])
    }
  }

  deleteByIds(ids: string[], options: { permanent?: boolean } = {}): DeleteAgentSessionsResult {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return { deletedIds: [] }
    const permanent = options.permanent === true

    const deletedIds = application.get('DbService').withWriteTx((tx) => {
      if (permanent) {
        const rows = tx
          .select({ session: sessionsTable, workspace: agentWorkspaceTable })
          .from(sessionsTable)
          .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
          .where(inArray(sessionsTable.id, uniqueIds))
          .all()

        return this.cascadeDeleteSessionRowsTx(tx, rows)
      }

      return this.archiveByIdsTx(tx, uniqueIds)
    })

    logger.info(permanent ? 'Permanently deleted sessions' : 'Archived sessions', { count: deletedIds.length })
    return { deletedIds }
  }

  /**
   * Archive (soft-delete) sessions: sets `deletedAt` on active rows only, so
   * re-archiving is idempotent and `deletedAt` is never overwritten. Session
   * pins are purged immediately — a surviving pin row would silently hide the
   * session from pin-JOINed listings, and pins are deliberately not restored.
   * System workspaces are NOT deleted on archive (restore must be lossless);
   * the backing workspace row/dir is only removed at purge.
   */
  archiveByIdsTx(tx: DbOrTx, ids: string[]): string[] {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const rows = tx
      .update(sessionsTable)
      .set({ deletedAt: Date.now() })
      .where(and(inArray(sessionsTable.id, uniqueIds), isNull(sessionsTable.deletedAt)))
      .returning({ id: sessionsTable.id })
      .all()
    const archivedIds = rows.map((row) => row.id)

    pinService.purgeForEntitiesTx(tx, 'session', archivedIds)
    return archivedIds
  }

  /**
   * Archive every active session belonging to an agent. Mirrors
   * `deleteByAgentIdTx`'s agent validation but routes through
   * {@link archiveByIdsTx} instead of the hard-delete cascade.
   */
  archiveByAgentIdTx(tx: DbOrTx, agentId: string, options: { validateAgent?: boolean } = {}): string[] {
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
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.agentId, agentId), isNull(sessionsTable.deletedAt)))
      .all()

    return this.archiveByIdsTx(
      tx,
      rows.map((row) => row.id)
    )
  }

  /**
   * Restore one trashed session: clears `deletedAt` so it re-enters active
   * listings. Throws NOT_FOUND when the row does not exist or is not trashed.
   * Pins purged at archive time are NOT restored.
   */
  restore(id: string): AgentSessionEntity {
    const result = application
      .get('DbService')
      .getDb()
      .update(sessionsTable)
      .set({ deletedAt: null })
      .where(and(eq(sessionsTable.id, id), isNotNull(sessionsTable.deletedAt)))
      .run()
    if (result.changes === 0) throw DataApiErrorFactory.notFound('Session', id)

    logger.info('Restored session', { id })
    return this.getById(id)
  }

  /**
   * Bulk-restore trashed sessions. Missing/active ids are ignored so
   * overlapping multi-window restores stay idempotent; `restoredIds` reports
   * what was actually restored.
   */
  restoreByIds(ids: string[]): RestoreAgentSessionsResult {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return { restoredIds: [] }

    const rows = application
      .get('DbService')
      .getDb()
      .update(sessionsTable)
      .set({ deletedAt: null })
      .where(and(inArray(sessionsTable.id, uniqueIds), isNotNull(sessionsTable.deletedAt)))
      .returning({ id: sessionsTable.id })
      .all()
    const restoredIds = rows.map((row) => row.id)

    logger.info('Restored sessions', { count: restoredIds.length })
    return { restoredIds }
  }

  /**
   * Purge sessions whose trash retention has expired (trash.purge job path).
   * Hard-deletes up to `limit` rows with `deletedAt < cutoffMs` inside the
   * caller's transaction via the cascade path (session messages FK-cascade,
   * backing system workspace rows removed, pins purged) and returns the
   * purged ids.
   */
  purgeExpiredTx(tx: DbOrTx, cutoffMs: number, limit: number): string[] {
    const rows = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(and(isNotNull(sessionsTable.deletedAt), lt(sessionsTable.deletedAt, cutoffMs)))
      .limit(limit)
      .all()
    if (rows.length === 0) return []

    return this.cascadeDeleteSessionRowsTx(tx, rows)
  }

  deleteWorkspaceCascade(workspaceId: string): void {
    application.get('DbService').withWriteTx((tx) => {
      agentWorkspaceService.getRowByIdTx(tx, workspaceId)
      this.deleteByWorkspaceTx(tx, workspaceId)
      agentWorkspaceService.deleteByIdTx(tx, workspaceId)
    })
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

  /**
   * `DELETE /agents/:agentId/sessions` path — archives (soft-deletes) every
   * active session of the agent. Hard deletion of an agent's sessions only
   * happens via {@link deleteByAgentIdTx} on the permanent agent-delete path.
   */
  deleteByAgentId(agentId: string): DeleteAgentSessionsResult {
    const deletedIds = application.get('DbService').withWriteTx((tx) => this.archiveByAgentIdTx(tx, agentId))

    logger.info('Archived agent sessions', { agentId, count: deletedIds.length })
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
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
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
    // Archived sessions read as absent — session-message writes must not
    // target them.
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
      .limit(1)
      .all()
    return !!row
  }
}

export const agentSessionService = new AgentSessionService()
