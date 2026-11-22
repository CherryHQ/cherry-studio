import { randomBytes } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, readdirSync } from 'node:fs'
import {
  access as accessAsync,
  lstat as lstatAsync,
  readFile as readFileAsync,
  readdir as readdirAsync
} from 'node:fs/promises'
import path from 'node:path'

import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, notInArray, or, type SQL, sql } from 'drizzle-orm'
import { chunk } from 'es-toolkit'
import { v4 as uuidv4 } from 'uuid'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTable as agentsTable } from '@data/db/schemas/agent'
import { agentRuntimeBackendTable } from '@data/db/schemas/agentRuntimeBackend'
import {
  type AgentSessionRow as SessionRow,
  type AgentSessionType,
  agentSessionTable as sessionsTable
} from '@data/db/schemas/agentSession'
import { agentSessionContextTable } from '@data/db/schemas/agentSessionContext'
import { agentSessionMessageTable } from '@data/db/schemas/agentSessionMessage'
import { type AgentWorkspaceRow, agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { pinTable } from '@data/db/schemas/pin'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentChannelService } from '@data/services/AgentChannelService'
import { agentWorkspaceService, rowToAgentWorkspace } from '@data/services/AgentWorkspaceService'
import { getDataService } from '@data/services/dataServiceRegistry'
import { modelService } from '@data/services/ModelService'
import { pinService } from '@data/services/PinService'
import { providerService } from '@data/services/ProviderService'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { Emitter, type Event } from '@main/core/lifecycle'
import { getAppLanguage } from '@main/i18n'
import { isDirectoryAccessible, isDirectoryAccessibleAsync, withProbeTimeout } from '@main/utils/isDirectoryAccessible'
import { parseJsonSortKey, selectNamePage } from '@main/utils/listOrdering'
import { buildSearchSnippet } from '@main/utils/searchSnippet'
import { isPiCompatibleModel } from '@shared/ai/piModelCompatibility'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type { OrderRequest } from '@shared/data/api/schemas/_endpointHelpers'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agentSessionMessages'
import type {
  AgentSessionEntity,
  CreateAgentSessionDto,
  DeleteAgentSessionsResult,
  GetAgentSessionQuery,
  LatestAgentSessionQuery,
  ListAgentSessionsQuery,
  ReusableAgentSessionPlaceholdersResponse,
  ReuseOrCreateAgentSessionDto,
  UpdateAgentSessionDto
} from '@shared/data/api/schemas/agentSessions'
import { AGENT_WORKSPACE_TYPE, type AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { EntitySearchItem } from '@shared/data/api/schemas/search'
import type { CursorPaginationResponse, DataApiDataChangeEffect } from '@shared/data/api/types'
import { isUniqueModelId, parseUniqueModelId, type UniqueModelId } from '@shared/data/types/model'
import { createNameComparator } from '@shared/utils/nameOrdering'

import { ensureAgentSessionRootTx } from './agentSessionMessageTree'
import { decodeListCursor, keysetOrdering } from './utils/keysetCursor'
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
const SQLITE_INARRAY_CHUNK = 500
const conversationFilter = eq(sessionsTable.type, 'conversation')
const ordinaryConversationFilter = isNull(sessionsTable.taskId)
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

export type AgentSessionBatchDeletionOutcome = AgentSessionDeletionOutcome & {
  purgedSystemWorkspacePaths: string[]
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
    model: (row.session.model ?? null) as UniqueModelId | null,
    name: clean.name,
    isNameManuallyEdited: clean.isNameManuallyEdited,
    description: clean.description,
    workspaceId: clean.workspaceId,
    workspace: rowToAgentWorkspace(row.workspace),
    traceId: clean.traceId,
    orderKey: clean.orderKey,
    lastActivityAt: timestampToISO(row.session.lastActivityAt),
    createdAt: timestampToISO(row.session.createdAt),
    updatedAt: timestampToISO(row.session.updatedAt),
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

export function agentSessionReadModelEffects(
  sessionIds: readonly string[],
  kind: 'membership' | 'projection'
): DataApiDataChangeEffect[] {
  if (sessionIds.length === 0) return []
  const entityIds = [...new Set(sessionIds)]
  const db = application.get('DbService').getDb()
  const backgroundIds = new Set(
    chunk(entityIds, SQLITE_INARRAY_CHUNK).flatMap((idChunk) =>
      db
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(and(inArray(sessionsTable.id, idChunk), eq(sessionsTable.type, 'background')))
        .all()
        .map((row) => row.id)
    )
  )
  const conversationIds = entityIds.filter((id) => !backgroundIds.has(id))
  if (conversationIds.length === 0) return [{ endpoint: '/agent-sessions/:sessionId', entityIds }]
  return [
    { endpoint: '/agent-sessions', kind, entityIds: conversationIds },
    { endpoint: '/agent-sessions', kind: 'order', dimension: 'lastActivityAt', entityIds: conversationIds },
    { endpoint: '/agent-sessions/:sessionId', entityIds },
    { endpoint: '/agent-sessions/latest' }
  ]
}

// Pi needs a resolvable, gateway-routable chat model; stale or subscription-only overrides cannot run.
function isPiServableUniqueModel(uniqueModelId: string): boolean {
  try {
    if (!isUniqueModelId(uniqueModelId)) return false
    const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
    return isPiCompatibleModel(providerService.getByProviderId(providerId), modelService.getByKey(providerId, modelId))
  } catch {
    return false
  }
}

/** Results of the filesystem probes a workspace recovery needs, gathered off the main thread. */
export interface AgentWorkspaceRecoveryPreflight {
  currentAccessible: boolean
  targetAccessible: boolean
  historyProblem?: string
  /** Workspace the probes were run against; a different one at write time means the request overlapped another. */
  expectedWorkspaceId?: string
}

const MANAGED_CLAUDE_ROOT_TAIL = '/Agents/.claude'

/** A saved managed Claude config dir from any machine: its absolute prefix differs, its tail does not. */
function isManagedClaudeConfigDir(dir: string): boolean {
  return dir.replace(/\\/g, '/').replace(/\/+$/, '').endsWith(MANAGED_CLAUDE_ROOT_TAIL)
}

type NativeHistoryProbe =
  | {
      kind: 'claude-code'
      configDir: string
      foreignConfigDir: boolean
      /** A managed-root branch from another profile path; its history may have been restored under ours. */
      relocatable: boolean
      managedRoot: string
      nativeThreadId: string | null
    }
  | { kind: 'pi'; sessionDir: string; suffix: string; required: boolean }
  | { kind: 'pi-durable'; storePath: string }

/**
 * A restored Pi archive must hold complete JSONL records: a slim backup can copy the expected
 * filename with a truncated record, and the pinned loader throws on it the next turn. An empty
 * file stays valid; Pi persists lazily, so a session may legitimately have no records yet.
 */
function hasCompleteJsonlRecords(content: string): boolean {
  for (const line of content.split('\n')) {
    const record = line.trim()
    if (!record) continue
    try {
      JSON.parse(record)
    } catch {
      return false
    }
  }
  return true
}

export class AgentSessionService {
  createChildArchiveTx(tx: DbOrTx, ownerSessionId: string, name: string): string {
    const owner = tx.select().from(sessionsTable).where(eq(sessionsTable.id, ownerSessionId)).get()
    if (!owner || owner.deletedAt) throw new Error('Child archive owner is unavailable')
    const id = uuidv4()
    this.insertTx(tx, {
      id,
      ownerSessionId,
      type: 'background',
      name,
      workspaceId: owner.workspaceId,
      agentId: owner.agentId,
      createdAt: Date.now(),
      updatedAt: Date.now()
    })
    ensureAgentSessionRootTx(tx, id)
    return id
  }

  assertIndependentSession(id: string): void {
    const row = application
      .get('DbService')
      .getDb()
      .select({ owner: sessionsTable.ownerSessionId })
      .from(sessionsTable)
      .where(eq(sessionsTable.id, id))
      .get()
    if (row?.owner) throw new Error('Child execution must be accessed through its native owner')
  }
  private readonly sessionUpdated = new Emitter<{ sessionId: string }>()
  readonly onSessionUpdated: Event<{ sessionId: string }> = this.sessionUpdated.event

  notifyReadModelChange(sessionIds: readonly string[], kind: 'membership' | 'projection'): void {
    const effects = agentSessionReadModelEffects(sessionIds, kind)
    if (effects.length === 0) return
    if (kind === 'membership') effects.push({ endpoint: '/agent-workspaces', kind: 'membership' })
    notifyDataApiDataChange(effects)
  }

  notifyPurged(sessionIds: readonly string[]): void {
    if (sessionIds.length === 0) return
    this.notifyReadModelChange(sessionIds, 'membership')
    notifyDataApiDataChange([
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership' },
      { endpoint: '/agent-sessions/:sessionId/messages/:messageId' }
    ])
  }

  listAddressableByCursor(query: {
    agentId?: string
    cursor?: string
    limit?: number
  }): CursorPaginationResponse<AddressableAgentSession> {
    const limit = Math.min(Math.max(query.limit ?? DEFAULT_LIMIT, 1), 100)
    const filters = [conversationFilter, isNull(agentsTable.deletedAt), isNull(sessionsTable.deletedAt)]
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
    const filters: SQL[] = [conversationFilter, isNull(sessionsTable.deletedAt)]
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

  create(
    dto: CreateAgentSessionDto,
    type: AgentSessionType = 'conversation',
    taskId: string | null = null
  ): AgentSessionEntity {
    const id = uuidv4()
    withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.createTx(tx, id, dto, type, Date.now(), taskId)),
      {
        ...defaultHandlersFor('Session', id),
        foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
      }
    )
    this.notifyReadModelChange([id], 'membership')
    return this.getById(id)
  }

  /**
   * DB-only create primitive for caller-owned transaction composition.
   * The caller supplies the reserved id and owns the outer commit boundary.
   */
  createTx(
    tx: DbOrTx,
    id: string,
    dto: CreateAgentSessionDto,
    type: AgentSessionType = 'conversation',
    createdAt = Date.now(),
    taskId: string | null = null
  ): void {
    this.assertAgentExistsTx(tx, dto.agentId)
    if (dto.model !== undefined && dto.model !== null && !isUniqueModelId(dto.model)) {
      throw DataApiErrorFactory.invalidOperation('create session', `unknown model: ${dto.model}`)
    }

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
      type,
      agentId: dto.agentId,
      name: dto.name,
      description: dto.description,
      model: dto.model,
      taskId,
      workspaceId,
      createdAt,
      updatedAt: createdAt
    })
    ensureAgentSessionRootTx(tx, id)
  }

  finishHistoryImportTx(tx: DbOrTx, sessionId: string, updatedAt: number): void {
    tx.update(sessionsTable)
      .set({ isNameManuallyEdited: true, updatedAt, lastActivityAt: updatedAt })
      .where(eq(sessionsTable.id, sessionId))
      .run()
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
      .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.deletedAt)))
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

  getConversationById(id: string, query: GetAgentSessionQuery = {}): AgentSessionEntity {
    return this.readById(
      id,
      and(conversationFilter, query.excludeTaskSessions ? ordinaryConversationFilter : undefined)
    )
  }

  getById(id: string, options?: { includeTaskReuse: boolean }) {
    return this.readById(id, undefined, options?.includeTaskReuse)
  }

  private readById(id: string, scope?: SQL, includeTaskReuse = false) {
    const db = application.get('DbService').getDb()
    const [row] = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(and(eq(sessionsTable.id, id), scope, isNull(sessionsTable.deletedAt)))
      .limit(1)
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)
    return {
      ...rowToSession(row),
      ...(includeTaskReuse && row.session.isTaskReuseTarget && { isTaskReuseTarget: true })
    }
  }

  /** Read all task-owned sessions, including non-reusing runs whose jobs were collected. */
  listTaskSessionIds(taskScheduleId: string): string[] {
    return application
      .get('DbService')
      .getDb()
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.taskId, taskScheduleId))
      .all()
      .map((row) => row.id)
  }

  getByTaskScheduleId(taskScheduleId: string): AgentSessionEntity | null {
    return this.getByTaskScheduleIdTx(application.get('DbService').getDb(), taskScheduleId)
  }

  getByTaskScheduleIdTx(tx: DbOrTx, taskScheduleId: string): AgentSessionEntity | null {
    const [row] = tx
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .innerJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
      .where(
        and(
          eq(sessionsTable.taskId, taskScheduleId),
          eq(sessionsTable.isTaskReuseTarget, true),
          isNull(sessionsTable.deletedAt)
        )
      )
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
      .select({ taskScheduleId: sessionsTable.taskId, sessionId: sessionsTable.id })
      .from(sessionsTable)
      .innerJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
      .where(
        and(
          inArray(sessionsTable.taskId, [...new Set(taskScheduleIds)]),
          eq(sessionsTable.isTaskReuseTarget, true),
          isNull(sessionsTable.deletedAt)
        )
      )
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
      .select({
        agentId: sessionsTable.agentId,
        taskId: sessionsTable.taskId,
        isTaskReuseTarget: sessionsTable.isTaskReuseTarget
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, params.sessionId), isNull(sessionsTable.deletedAt)))
      .limit(1)
      .all()
    if (!session) throw DataApiErrorFactory.notFound('Session', params.sessionId)
    if (session.agentId !== params.expectedAgentId || session.isTaskReuseTarget) return false
    if (session.taskId !== null && session.taskId !== params.taskScheduleId) return false

    const alreadyBound = tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.taskId, params.taskScheduleId), eq(sessionsTable.isTaskReuseTarget, true)))
      .limit(1)
      .all()
    if (alreadyBound.length > 0) return false

    return (
      tx
        .update(sessionsTable)
        .set({ taskId: params.taskScheduleId, isTaskReuseTarget: true, updatedAt: sql`${sessionsTable.updatedAt}` })
        .where(eq(sessionsTable.id, params.sessionId))
        .run().changes > 0
    )
  }

  clearTaskScheduleTx(tx: DbOrTx, taskScheduleId: string): boolean {
    return this.clearTaskReuseTx(
      tx,
      and(eq(sessionsTable.taskId, taskScheduleId), eq(sessionsTable.isTaskReuseTarget, true))!
    )
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
    purgedSystemWorkspacePaths: string[]
  } {
    const sessions = tx
      .select({ id: sessionsTable.id, taskScheduleId: sessionsTable.taskId })
      .from(sessionsTable)
      .where(eq(sessionsTable.agentId, agentId))
      .all()
    const taskScheduleIds = sessions.flatMap((session) => (session.taskScheduleId ? [session.taskScheduleId] : []))

    if (options.deleteSessions) {
      const deliveryResults: AgentSessionMessageEntity[] = []
      const purgedSystemWorkspacePaths = tx
        .select({ path: agentWorkspaceTable.path })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(
          and(
            eq(sessionsTable.agentId, agentId),
            isNull(sessionsTable.ownerSessionId),
            eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.SYSTEM)
          )
        )
        .all()
        .map((row) => row.path)
      return {
        sessionIds: this.deleteByAgentIdTx(tx, agentId, { validateAgent: false, deliveryResults }),
        taskScheduleIds,
        changeKind: 'membership',
        deliveryResults,
        purgedSystemWorkspacePaths
      }
    }

    if (taskScheduleIds.length > 0) {
      this.clearTaskReuseTx(tx, and(eq(sessionsTable.agentId, agentId), isNotNull(sessionsTable.taskId))!)
    }
    const sessionIds = sessions.map((session) => session.id)
    return {
      sessionIds,
      taskScheduleIds,
      changeKind: 'projection',
      purgedSystemWorkspacePaths: [],
      deliveryResults: getDataService('AgentSessionMessageService').prepareRetainedSessionAgentDeletionTx(
        tx,
        sessionIds
      )
    }
  }

  /** Relation maintenance is not session activity and must not affect recency restore. */
  private clearTaskReuseTx(tx: DbOrTx, where: SQL): boolean {
    return (
      tx
        .update(sessionsTable)
        // Explicit self-assignment suppresses updatedAt's table-level $onUpdateFn.
        .set({ isTaskReuseTarget: false, updatedAt: sql`${sessionsTable.updatedAt}` })
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
   *
   * An optional `agentId` narrows the scan to one agent's sessions — used by
   * per-agent sidebar entries to resume that agent's last conversation.
   */
  getLatestActive(query: LatestAgentSessionQuery = {}): AgentSessionEntity | null {
    const db = application.get('DbService').getDb()
    const ownerFilter =
      query.agentId === 'unlinked'
        ? or(isNull(sessionsTable.agentId), isNull(agentsTable.id))
        : query.agentId
          ? eq(agentsTable.id, query.agentId)
          : undefined
    const [row] = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .leftJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
      .where(and(conversationFilter, ordinaryConversationFilter, isNull(sessionsTable.deletedAt), ownerFilter))
      .orderBy(desc(sessionsTable.lastActivityAt), asc(sessionsTable.id))
      .limit(1)
      .all()
    return row ? rowToSession(row) : null
  }

  /** Reuse or create one exact empty placeholder under a serialized write transaction. */
  reuseOrCreatePlaceholderWithImpact(dto: ReuseOrCreateAgentSessionDto): ReuseOrCreateAgentSessionOutcome {
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
                conversationFilter,
                eq(sessionsTable.agentId, dto.agentId),
                isNull(sessionsTable.deletedAt),
                workspaceFilter,
                dto.excludeSessionId ? notInArray(sessionsTable.id, [dto.excludeSessionId]) : undefined,
                eq(sessionsTable.isNameManuallyEdited, false),
                sql`trim(${sessionsTable.name}) = ''`,
                sql`NOT EXISTS (
                  SELECT 1
                  FROM ${agentSessionMessageTable}
                  WHERE ${agentSessionMessageTable.sessionId} = ${sessionsTable.id}
                    AND ${agentSessionMessageTable.role} != 'root'
                )`
              )
            )
            .orderBy(desc(sessionsTable.updatedAt), asc(sessionsTable.id))
            .all()

          const reusable = reusableRows[0]
          if (reusable) {
            const now = Date.now()
            this.advanceLastActivityAtTx(tx, reusable.session.id, now)
            const updatedSession = tx
              .select({ session: sessionsTable, workspace: agentWorkspaceTable })
              .from(sessionsTable)
              .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
              .where(eq(sessionsTable.id, reusable.session.id))
              .limit(1)
              .all()
            if (!updatedSession.length) throw DataApiErrorFactory.notFound('Session', reusable.session.id)
            const duplicateDeletion =
              dto.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM
                ? this.cascadeDeleteSessionRowsTx(tx, reusableRows.slice(1))
                : { deletedIds: [], taskScheduleIds: [], deliveryResults: [] }
            return {
              session: rowToSession(updatedSession[0]),
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
      .where(and(eq(sessionsTable.id, sessionId), isNull(sessionsTable.deletedAt)))
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
   * by the selected sort key and `id ASC` (default: manual `orderKey ASC`). A partial
   * pin page spills into the unpinned section to fill `limit`. Pins float a
   * session to the top independent of its own `orderKey`, so both rails share
   * one pagination contract; sorting is applied before reading each page.
   */
  listByCursor(
    query: ListAgentSessionsQuery & { scope: 'ordinary' | 'all-conversations'; taskId?: string }
  ): CursorPaginationResponse<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const limit = Math.min(query.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const cursor = decodePinnedListCursor(query.cursor, 'agent-session')
    const sortBy = query.sortBy ?? 'orderKey'
    const direction = query.sortOrder ?? (sortBy === 'orderKey' ? 'asc' : 'desc')
    const ordering = keysetOrdering(sessionsTable[sortBy], sessionsTable.id, { major: direction, tie: 'asc' })
    const boundary =
      cursor.section === 'entity' && cursor.orderKey !== null
        ? sortBy === 'orderKey'
          ? { key: cursor.orderKey, id: cursor.id }
          : decodeListCursor(
              `${cursor.orderKey}:${cursor.id}`,
              (key) => parseJsonSortKey(key, sortBy === 'name' ? 'string' : 'number'),
              'agent-session'
            )
        : null
    const agentFilter = query.agentId ? eq(sessionsTable.agentId, query.agentId) : undefined
    const workspaceFilter = query.workspaceId ? eq(sessionsTable.workspaceId, query.workspaceId) : undefined
    const idFilter = query.ids ? inArray(sessionsTable.id, query.ids) : undefined
    const taskIdFilter = query.taskId ? eq(sessionsTable.taskId, query.taskId) : undefined
    const inTrash = query.inTrash === true
    const taskFilter =
      query.scope === 'all-conversations' || inTrash || query.ids ? undefined : ordinaryConversationFilter
    const activeAgentFilter = !inTrash && query.agentId ? isNotNull(agentsTable.id) : undefined

    const items: Array<{ session: AgentSessionEntity; pinOrderKey?: string }> = []

    if (!inTrash && cursor.section === 'pin') {
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
        .leftJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
        .innerJoin(pinTable, and(eq(pinTable.entityType, 'session'), eq(pinTable.entityId, sessionsTable.id)))
        .where(
          and(
            conversationFilter,
            taskFilter,
            taskIdFilter,
            agentFilter,
            workspaceFilter,
            idFilter,
            activeAgentFilter,
            isNull(sessionsTable.deletedAt),
            pinAfter
          )
        )
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

    // The id tiebreak keeps equal sort keys distinct across pages.
    const remaining = limit - items.length
    const pinnedSubquery = db.select({ id: pinTable.entityId }).from(pinTable).where(eq(pinTable.entityType, 'session'))

    const sessionFilter = and(
      conversationFilter,
      taskFilter,
      taskIdFilter,
      agentFilter,
      workspaceFilter,
      idFilter,
      activeAgentFilter,
      inTrash ? isNotNull(sessionsTable.deletedAt) : isNull(sessionsTable.deletedAt),
      notInArray(sessionsTable.id, pinnedSubquery)
    )
    const compareNames =
      sortBy === 'name' ? createNameComparator(query.sortLocale ?? getAppLanguage(), direction) : undefined
    const namePage = compareNames
      ? selectNamePage({
          names: db
            .select({ id: sessionsTable.id, name: sessionsTable.name })
            .from(sessionsTable)
            .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
            .leftJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
            .where(sessionFilter)
            .all(),
          after: boundary && typeof boundary.key === 'string' ? { name: boundary.key, id: boundary.id } : undefined,
          compare: compareNames,
          limit: remaining + 1
        })
      : undefined
    const sessionRows = db
      .select({ session: sessionsTable, workspace: agentWorkspaceTable })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .leftJoin(agentsTable, and(eq(sessionsTable.agentId, agentsTable.id), isNull(agentsTable.deletedAt)))
      .where(
        and(
          sessionFilter,
          namePage
            ? inArray(
                sessionsTable.id,
                namePage.map((row) => row.id)
              )
            : boundary
              ? ordering.where(boundary)
              : undefined
        )
      )
      .orderBy(...ordering.orderBy)
      .limit(remaining + 1)
      .all()

    if (compareNames) sessionRows.sort((a, b) => compareNames(a.session, b.session))

    const hasMoreInSession = sessionRows.length > remaining
    for (const row of sessionRows.slice(0, remaining)) {
      items.push({ session: rowToSession(row) })
    }

    let nextCursor: string | undefined
    if (hasMoreInSession) {
      const last = sessionRows[remaining - 1]
      nextCursor = encodeEntityCursor(
        sortBy === 'orderKey' ? last.session.orderKey : encodeURIComponent(JSON.stringify(last.session[sortBy])),
        last.session.id
      )
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
    if (dto.model !== undefined) patch.model = dto.model
    if (Object.keys(patch).length === 0) return this.getById(id)

    const result = withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.updateTx(tx, id, patch)),
      defaultHandlersFor('Session', id)
    )
    if (!result.row) throw DataApiErrorFactory.notFound('Session', id)
    publishTaskReadModelChanges(result.clearedTaskScheduleIds)
    this.notifyReadModelChange([id], 'projection')
    this.sessionUpdated.fire({ sessionId: id })
    return this.getById(id)
  }

  updateTx(
    tx: DbOrTx,
    id: string,
    patch: UpdateAgentSessionDto
  ): { row: SessionRow | undefined; clearedTaskScheduleIds: string[] } {
    const [current] = tx
      .select({
        agentId: sessionsTable.agentId,
        taskScheduleId: sessionsTable.taskId,
        model: sessionsTable.model
      })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
      .limit(1)
      .all()
    if (!current) return { row: undefined, clearedTaskScheduleIds: [] }
    if (patch.agentId !== undefined) this.assertAgentExistsTx(tx, patch.agentId)
    if (patch.model !== undefined && patch.model !== null && !isUniqueModelId(patch.model)) {
      throw DataApiErrorFactory.invalidOperation('update session', `unknown model: ${patch.model}`)
    }

    const previousAgentId = current.agentId
    const reassigned = patch.agentId !== undefined && patch.agentId !== previousAgentId
    if (reassigned && patch.model === undefined && current.model != null) {
      // A cross-runtime reassignment may make the override unservable, so clear it atomically;
      // same-runtime reassignment keeps the override.
      const agentTypes = tx
        .select({ id: agentsTable.id, type: agentsTable.type })
        .from(agentsTable)
        .where(
          inArray(
            agentsTable.id,
            previousAgentId != null ? [previousAgentId, patch.agentId as string] : [patch.agentId as string]
          )
        )
        .all()
      const typeOf = new Map(agentTypes.map((row) => [row.id, row.type]))
      if (previousAgentId != null) {
        if (typeOf.get(previousAgentId) !== typeOf.get(patch.agentId as string)) {
          patch.model = null
        }
      } else if (
        ['pi', 'pi-durable'].includes(typeOf.get(patch.agentId as string) ?? '') &&
        !isPiServableUniqueModel(current.model)
      ) {
        // A deleted parent leaves no runtime type to compare; discard an override the new Pi agent
        // cannot serve so the session can use its default.
        patch.model = null
      }
    }
    const clearedTaskScheduleIds = reassigned && current.taskScheduleId ? [current.taskScheduleId] : []
    if (reassigned && current.taskScheduleId) {
      this.clearTaskReuseTx(tx, eq(sessionsTable.id, id))
    }
    const [row] = tx
      .update(sessionsTable)
      .set(patch)
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
      .returning()
      .all()
    if (reassigned) {
      tx.update(sessionsTable).set({ agentId: patch.agentId }).where(eq(sessionsTable.ownerSessionId, id)).run()
    }
    return { row, clearedTaskScheduleIds }
  }

  /**
   * Replace a session's workspace. A session with messages may only change its
   * workspace when the current user workspace folder is inaccessible, so a
   * migrated or moved Agent can be re-pointed at a valid folder. Lives on
   * `PUT /agent-sessions/:id/workspace` rather than the generic PATCH because it
   * creates/deletes the backing system workspace row.
   */
  setWorkspace(
    id: string,
    source: AgentSessionWorkspaceSource,
    preflight?: AgentWorkspaceRecoveryPreflight
  ): AgentSessionEntity {
    withSqliteErrors(
      () => {
        const current = this.getJoinedSessionRowTx(application.get('DbService').getDb(), id)
        if (preflight?.expectedWorkspaceId && preflight.expectedWorkspaceId !== current.session.workspaceId) {
          throw DataApiErrorFactory.invalidOperation(
            'update session workspace',
            'the conversation workspace changed while recovery was being checked; try again'
          )
        }
        // An empty chat is free to switch, so its folders are never probed.
        const lockApplies =
          source.type === AGENT_WORKSPACE_TYPE.USER &&
          current.workspace.type === AGENT_WORKSPACE_TYPE.USER &&
          this.sessionHasMessages(application.get('DbService').getDb(), id)
        const inaccessibleWorkspaceId =
          lockApplies && !(preflight ? preflight.currentAccessible : isDirectoryAccessible(current.workspace.path))
            ? current.workspace.id
            : undefined
        if (inaccessibleWorkspaceId && source.type === AGENT_WORKSPACE_TYPE.USER) {
          // Recovery must land on a usable folder and on history this profile can still continue; both
          // are probed here (or by the async preflight), outside the write transaction.
          const target = agentWorkspaceService.getRowByIdTx(application.get('DbService').getDb(), source.workspaceId)
          const targetAccessible =
            target.id === current.session.workspaceId ||
            (preflight ? preflight.targetAccessible : isDirectoryAccessible(target.path))
          if (!targetAccessible) {
            throw DataApiErrorFactory.invalidOperation(
              'update session workspace',
              'the replacement workspace folder is not accessible'
            )
          }
          const historyProblem = preflight
            ? preflight.historyProblem
            : this.findNativeHistoryProblem(this.listNativeHistoryProbes(id), (probe) => this.probeHistorySync(probe))
          if (historyProblem) {
            throw DataApiErrorFactory.invalidOperation('update session workspace', historyProblem)
          }
          if (
            !preflight &&
            this.listNativeHistoryProbes(id).some((probe) => probe.kind === 'claude-code' && probe.nativeThreadId)
          ) {
            throw DataApiErrorFactory.invalidOperation(
              'update session workspace',
              'Claude history recovery requires asynchronous native verification'
            )
          }
        }
        application.get('DbService').withWriteTx((tx) => this.setWorkspaceTx(tx, id, source, inaccessibleWorkspaceId))
      },
      defaultHandlersFor('Session', id)
    )
    notifyDataApiDataChange([
      ...agentSessionReadModelEffects([id], 'projection'),
      { endpoint: '/agent-workspaces', kind: 'membership' }
    ])
    this.sessionUpdated.fire({ sessionId: id })
    return this.getById(id)
  }

  /**
   * Run the filesystem probes `setWorkspace` needs without blocking the main thread, then apply the
   * change with their results. A stalled mount resolves as inaccessible after a bounded wait.
   */
  async setWorkspaceRecovering(id: string, source: AgentSessionWorkspaceSource): Promise<AgentSessionEntity> {
    const db = application.get('DbService').getDb()
    const current = this.getJoinedSessionRowTx(db, id)
    if (
      source.type !== AGENT_WORKSPACE_TYPE.USER ||
      current.workspace.type !== AGENT_WORKSPACE_TYPE.USER ||
      !this.sessionHasMessages(db, id)
    ) {
      return this.setWorkspace(id, source)
    }
    const target = agentWorkspaceService.getRowByIdTx(db, source.workspaceId)
    const expectedWorkspaceId = current.session.workspaceId
    if (await isDirectoryAccessibleAsync(current.workspace.path)) {
      return this.setWorkspace(id, source, { currentAccessible: true, targetAccessible: true, expectedWorkspaceId })
    }
    const targetInitiallyAccessible =
      target.id === current.session.workspaceId || (await isDirectoryAccessibleAsync(target.path))
    if (!targetInitiallyAccessible) {
      return this.setWorkspace(id, source, { currentAccessible: false, targetAccessible: false, expectedWorkspaceId })
    }
    const probes = this.listNativeHistoryProbes(id)
    let historyProblem: string | undefined
    for (const probe of probes) {
      historyProblem = this.describeHistoryProblem(probe, await this.probeHistoryAsync(probe))
      if (historyProblem) break
      if (probe.kind === 'claude-code' && probe.nativeThreadId) {
        try {
          const { recoverClaudeWorkspaceHistory } = await import('@main/ai/runtime/claudeCode')
          await recoverClaudeWorkspaceHistory({
            configDir: probe.foreignConfigDir ? probe.managedRoot : probe.configDir,
            targetCwd: target.path,
            sourceCwd: current.workspace.path,
            nativeThreadId: probe.nativeThreadId
          })
        } catch {
          historyProblem =
            "this conversation's Claude Code history cannot be reopened from the replacement workspace; the original binding is unchanged"
          break
        }
      }
    }
    // Recheck both folders after native-history work. These are best-effort filesystem observations,
    // not a lock against a drive being detached immediately after the check.
    const currentAccessible = await isDirectoryAccessibleAsync(current.workspace.path)
    // Do not carry a successful target probe across a potentially stalled original-folder check.
    const targetAccessible =
      target.id === current.session.workspaceId ? true : await isDirectoryAccessibleAsync(target.path)
    return this.setWorkspace(id, source, { currentAccessible, targetAccessible, historyProblem, expectedWorkspaceId })
  }

  /**
   * Config directories this profile's Claude Code runtime can run a branch under: the managed root
   * used for API-key providers, the user's own Claude config used for the login provider, and an
   * explicit override. A branch saved under none of them belongs to another data directory.
   */
  private effectiveClaudeConfigDirs(): Set<string> {
    const home = application.getPath('sys.home')
    const dirs = [
      process.env.CLAUDE_CONFIG_DIR,
      application.getPath('feature.agents.claude.root'),
      application.getPath('external.claude.config'),
      home ? path.join(home, '.claude') : undefined
    ]
    return new Set(dirs.filter((dir): dir is string => Boolean(dir)).map((dir) => path.resolve(dir)))
  }

  private listNativeHistoryProbes(sessionId: string): NativeHistoryProbe[] {
    const configDirs = this.effectiveClaudeConfigDirs()
    const piSessionDir = application.getPath('feature.agents.pi.sessions')
    const db = application.get('DbService').getDb()
    return db
      .select({
        contextId: agentSessionContextTable.id,
        locator: agentRuntimeBackendTable.locator,
        nativeThreadId: agentSessionContextTable.nativeThreadId,
        bindingState: agentSessionContextTable.bindingState
      })
      .from(agentSessionContextTable)
      .innerJoin(agentRuntimeBackendTable, eq(agentSessionContextTable.backendId, agentRuntimeBackendTable.id))
      .where(eq(agentSessionContextTable.sessionId, sessionId))
      .all()
      .flatMap(({ contextId, locator, nativeThreadId, bindingState }): NativeHistoryProbe[] => {
        if (locator.kind === 'claude-code') {
          if (bindingState === 'pending') {
            const input = db
              .select({ id: agentSessionMessageTable.id })
              .from(agentSessionMessageTable)
              .where(
                and(
                  eq(agentSessionMessageTable.sessionId, sessionId),
                  eq(agentSessionMessageTable.inputContextId, contextId)
                )
              )
              .limit(1)
              .get()
            if (!input) return []
          }
          return [
            {
              kind: 'claude-code',
              configDir: locator.configDir,
              foreignConfigDir: !configDirs.has(path.resolve(locator.configDir)),
              relocatable: isManagedClaudeConfigDir(locator.configDir),
              managedRoot: application.getPath('feature.agents.claude.root'),
              nativeThreadId
            }
          ]
        }
        if (locator.kind === 'pi' || locator.kind === 'pi-durable') {
          // Pi opens an archive for a bound branch and for a pending one that already has input.
          const [input] = db
            .select({ id: agentSessionMessageTable.id })
            .from(agentSessionMessageTable)
            .where(
              and(
                eq(agentSessionMessageTable.sessionId, sessionId),
                eq(agentSessionMessageTable.inputContextId, contextId)
              )
            )
            .limit(1)
            .all()
          const required = bindingState === 'bound' || Boolean(input)
          if (!required) return []
          if (locator.kind === 'pi-durable') {
            // A slim backup can carry the binding without its native store; the next turn would
            // fail to open it, so recovery must refuse instead of clearing the warning.
            return [
              {
                kind: 'pi-durable',
                storePath: application.getPath('feature.agents.durable.stores', locator.fileName)
              }
            ]
          }
          return nativeThreadId
            ? [{ kind: 'pi', sessionDir: piSessionDir, suffix: `_${nativeThreadId}.jsonl`, required }]
            : []
        }
        return []
      })
  }

  private probeHistorySync(probe: NativeHistoryProbe): boolean {
    if (probe.kind === 'claude-code') {
      if (!probe.foreignConfigDir) return true
      if (!probe.relocatable || !probe.nativeThreadId) return false
      try {
        const projects = path.join(probe.managedRoot, 'projects')
        return readdirSync(projects).some((dir) =>
          existsSync(path.join(projects, dir, `${probe.nativeThreadId}.jsonl`))
        )
      } catch {
        return false
      }
    }
    if (probe.kind === 'pi-durable') {
      try {
        return lstatSync(probe.storePath).isFile()
      } catch {
        return false
      }
    }
    try {
      const files = readdirSync(probe.sessionDir).filter((file) => file.endsWith(probe.suffix))
      if (files.length !== 1) return false
      const archive = path.join(probe.sessionDir, files[0])
      return lstatSync(archive).isFile() && hasCompleteJsonlRecords(readFileSync(archive, 'utf8'))
    } catch {
      return false
    }
  }

  private async probeHistoryAsync(probe: NativeHistoryProbe): Promise<boolean> {
    if (probe.kind === 'claude-code') {
      if (!probe.foreignConfigDir) return true
      if (!probe.relocatable || !probe.nativeThreadId) return false
      try {
        const projects = path.join(probe.managedRoot, 'projects')
        const dirs = await withProbeTimeout(readdirAsync(projects))
        for (const dir of dirs) {
          try {
            await withProbeTimeout(accessAsync(path.join(projects, dir, `${probe.nativeThreadId}.jsonl`)))
            return true
          } catch {
            // try the next project directory
          }
        }
        return false
      } catch {
        return false
      }
    }
    if (probe.kind === 'pi-durable') {
      try {
        return (await withProbeTimeout(lstatAsync(probe.storePath))).isFile()
      } catch {
        return false
      }
    }
    try {
      const files = (await withProbeTimeout(readdirAsync(probe.sessionDir))).filter((file) =>
        file.endsWith(probe.suffix)
      )
      if (files.length !== 1) return false
      const archive = path.join(probe.sessionDir, files[0])
      if (!(await withProbeTimeout(lstatAsync(archive))).isFile()) return false
      return hasCompleteJsonlRecords(await withProbeTimeout(readFileAsync(archive, 'utf8')))
    } catch {
      return false
    }
  }

  private describeHistoryProblem(probe: NativeHistoryProbe, reachable: boolean): string | undefined {
    if (reachable) return undefined
    if (probe.kind === 'claude-code')
      return "this conversation's Claude Code history belongs to another data directory and cannot be continued here; start a new conversation or restore the original data directory"
    return probe.kind === 'pi-durable'
      ? "this conversation's Pi history store is missing from this data directory and cannot be continued here; start a new conversation or restore the original data directory"
      : "this conversation's Pi history file is missing or incomplete in this data directory and cannot be continued here; start a new conversation or restore the original data directory"
  }

  /**
   * Native history lives outside the workspace. After a restore into a different profile the runtime
   * rejects the branch on the next turn (Claude: its config directory differs from the effective one;
   * Pi: its session file is absent), so rebinding the folder would only clear the warning. Fail with a
   * reason instead, leaving the binding and recovery state in place.
   */
  private findNativeHistoryProblem(
    probes: NativeHistoryProbe[],
    probe: (probe: NativeHistoryProbe) => boolean
  ): string | undefined {
    for (const item of probes) {
      const problem = this.describeHistoryProblem(item, probe(item))
      if (problem) return problem
    }
    return undefined
  }

  private setWorkspaceTx(
    tx: DbOrTx,
    id: string,
    source: AgentSessionWorkspaceSource,
    inaccessibleWorkspaceId?: string
  ): void {
    const current = this.getJoinedSessionRowTx(tx, id)
    const recoveringMissingWorkspace =
      source.type === AGENT_WORKSPACE_TYPE.USER &&
      current.workspace.type === AGENT_WORKSPACE_TYPE.USER &&
      current.workspace.id === inaccessibleWorkspaceId
    // The workspace binding is locked once a session has messages, unless its folder is gone (migrated/renamed/unplugged).
    if (!recoveringMissingWorkspace) this.assertSessionHasNoMessagesTx(tx, id)
    if (recoveringMissingWorkspace) this.rebindRestoredClaudeHistoryTx(tx, id)

    if (source.type === AGENT_WORKSPACE_TYPE.USER) {
      const workspace = agentWorkspaceService.getRowByIdTx(tx, source.workspaceId)
      if (workspace.id === current.session.workspaceId) return
      // Repoint first, then drop the old system workspace so the session FK never dangles.
      tx.update(sessionsTable).set({ workspaceId: workspace.id }).where(eq(sessionsTable.id, id)).run()
      this.moveChildArchivesTx(tx, id, current.session.workspaceId, workspace.id)
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
    this.moveChildArchivesTx(tx, id, current.session.workspaceId, workspace.id)
  }

  /**
   * A full backup carries the managed Claude history under this profile's own data directory while the
   * saved backend still names the source machine's path. Recovery already verified the restored
   * transcript, so point the conversation's Claude branches at this profile's managed root.
   */
  private rebindRestoredClaudeHistoryTx(tx: DbOrTx, sessionId: string): void {
    const configDirs = this.effectiveClaudeConfigDirs()
    const managedRoot = application.getPath('feature.agents.claude.root')
    const rows = tx
      .select({
        contextId: agentSessionContextTable.id,
        locator: agentRuntimeBackendTable.locator,
        state: agentRuntimeBackendTable.state,
        checkpointMapping: agentSessionContextTable.checkpointMapping
      })
      .from(agentSessionContextTable)
      .innerJoin(agentRuntimeBackendTable, eq(agentSessionContextTable.backendId, agentRuntimeBackendTable.id))
      .where(eq(agentSessionContextTable.sessionId, sessionId))
      .all()
    for (const { contextId, locator, state, checkpointMapping } of rows) {
      if (locator.kind !== 'claude-code') continue
      if (configDirs.has(path.resolve(locator.configDir)) || !isManagedClaudeConfigDir(locator.configDir)) continue
      const next = { version: 1 as const, kind: 'claude-code' as const, configDir: managedRoot }
      tx.insert(agentRuntimeBackendTable).values({ locator: next, state }).onConflictDoNothing().run()
      const [backend] = tx
        .select({ id: agentRuntimeBackendTable.id })
        .from(agentRuntimeBackendTable)
        .where(eq(agentRuntimeBackendTable.locator, next))
        .all()
      if (backend) {
        const fork = checkpointMapping?.fork
        const remappedFork =
          fork &&
          Object.fromEntries(
            Object.entries(fork).map(([id, value]) => {
              if (
                value &&
                typeof value === 'object' &&
                'runtime' in value &&
                value.runtime === 'claude-code' &&
                'configDir' in value &&
                value.configDir === locator.configDir
              ) {
                return [id, { ...value, configDir: managedRoot }]
              }
              return [id, value]
            })
          )
        tx.update(agentSessionContextTable)
          .set({
            backendId: backend.id,
            ...(remappedFork ? { checkpointMapping: { ...checkpointMapping, fork: remappedFork } } : {})
          })
          .where(eq(agentSessionContextTable.id, contextId))
          .run()
        // Fork checkpoints are adapter-owned addresses too; keeping the old profile path would
        // break forks from replies made before the restore even though the backend was rebound.
        tx.update(agentSessionMessageTable)
          .set({
            data: sql`json_set(${agentSessionMessageTable.data}, '$.runtimeAnchor.checkpoint.configDir', ${managedRoot})`,
            updatedAt: agentSessionMessageTable.updatedAt
          })
          .where(
            and(
              eq(agentSessionMessageTable.sessionId, sessionId),
              sql`json_extract(${agentSessionMessageTable.data}, '$.runtimeAnchor.checkpoint.runtime') = 'claude-code'`,
              sql`json_extract(${agentSessionMessageTable.data}, '$.runtimeAnchor.checkpoint.configDir') = ${locator.configDir}`
            )
          )
          .run()
      }
    }
  }

  /** Subagent archives share their owner's workspace, so a deletion of the old one must not reach them. */
  private moveChildArchivesTx(tx: DbOrTx, ownerId: string, fromWorkspaceId: string, toWorkspaceId: string): void {
    tx.update(sessionsTable)
      .set({ workspaceId: toWorkspaceId })
      .where(and(eq(sessionsTable.ownerSessionId, ownerId), eq(sessionsTable.workspaceId, fromWorkspaceId)))
      .run()
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

  private sessionHasMessages(tx: DbOrTx, sessionId: string): boolean {
    const [message] = tx
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(and(eq(agentSessionMessageTable.sessionId, sessionId), sql`${agentSessionMessageTable.role} != 'root'`))
      .limit(1)
      .all()
    return Boolean(message)
  }

  private assertSessionHasNoMessagesTx(tx: DbOrTx, sessionId: string): void {
    const [message] = tx
      .select({ id: agentSessionMessageTable.id })
      .from(agentSessionMessageTable)
      .where(and(eq(agentSessionMessageTable.sessionId, sessionId), sql`${agentSessionMessageTable.role} != 'root'`))
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
      type: AgentSessionType
      id: string
      agentId: string | null
      ownerSessionId?: string
      taskId?: string | null
      name: string
      description?: string
      model?: UniqueModelId | null
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

  delete(id: string, options: { permanent?: boolean } = {}): void {
    this.deleteWithImpact(id, options)
  }

  deleteWithImpact(id: string, options: { permanent?: boolean } = {}): AgentSessionDeletionOutcome {
    if (options.permanent !== true) {
      const { trashedIds, taskScheduleIds, deliveryResults } = application
        .get('DbService')
        .withWriteTx((tx) => this.trashByIdsTx(tx, [id], { requireAll: true }))
      publishTaskReadModelChanges(taskScheduleIds)
      getDataService('AgentSessionMessageService').publishDeliveryChanges(deliveryResults)
      this.notifyReadModelChange(trashedIds, 'membership')
      if (trashedIds.length > 0) pinService.notifyPurged()
      return { deletedIds: trashedIds, taskScheduleIds, deliveryResults }
    }

    const result = application.get('DbService').withWriteTx((tx) => {
      const [row] = tx
        .select({ session: sessionsTable, workspace: agentWorkspaceTable })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(and(eq(sessionsTable.id, id), isNotNull(sessionsTable.deletedAt)))
        .limit(1)
        .all()
      if (!row) throw DataApiErrorFactory.notFound('Session', id)
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

  deleteByIds(ids: string[], options: { permanent?: boolean } = {}): DeleteAgentSessionsResult {
    const result = this.deleteByIdsWithImpact(ids, options)
    return { deletedIds: result.deletedIds }
  }

  deleteByIdsWithImpact(
    ids: string[],
    options: { permanent?: boolean; targetState?: 'active' | 'trashed' } = {}
  ): AgentSessionBatchDeletionOutcome {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) {
      return { deletedIds: [], taskScheduleIds: [], deliveryResults: [], purgedSystemWorkspacePaths: [] }
    }

    const result = application.get('DbService').withWriteTx((tx) => {
      if (options.permanent !== true) {
        const { trashedIds, taskScheduleIds, deliveryResults } = this.trashByIdsTx(tx, uniqueIds)
        return { deletedIds: trashedIds, taskScheduleIds, deliveryResults, purgedSystemWorkspacePaths: [] }
      }

      const rows = chunk(uniqueIds, SQLITE_INARRAY_CHUNK).flatMap((idChunk) =>
        tx
          .select({ session: sessionsTable, workspace: agentWorkspaceTable })
          .from(sessionsTable)
          .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
          .where(
            and(
              inArray(sessionsTable.id, idChunk),
              options.targetState === 'active' ? isNull(sessionsTable.deletedAt) : isNotNull(sessionsTable.deletedAt)
            )
          )
          .all()
      )

      if (options.targetState === 'active' && rows.length > 0) {
        const pinnedIds = chunk(
          rows.map((row) => row.session.id),
          SQLITE_INARRAY_CHUNK
        )
          .flatMap((idChunk) =>
            tx
              .select({ entityId: pinTable.entityId })
              .from(pinTable)
              .where(and(eq(pinTable.entityType, 'session'), inArray(pinTable.entityId, idChunk)))
              .all()
          )
          .map((row) => row.entityId)
          .sort()
        if (pinnedIds.length > 0) {
          throw DataApiErrorFactory.invalidOperation('delete pinned session', pinnedIds.join(','))
        }
      }

      return {
        ...this.cascadeDeleteSessionRowsTx(tx, rows),
        purgedSystemWorkspacePaths: rows
          .filter((row) => row.session.ownerSessionId === null && row.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM)
          .map((row) => row.workspace.path)
      }
    })

    publishTaskReadModelChanges(result.taskScheduleIds)
    getDataService('AgentSessionMessageService').publishDeliveryChanges(result.deliveryResults)
    this.notifyReadModelChange(result.deletedIds, 'membership')
    if (result.deletedIds.length > 0) pinService.notifyPurged()
    logger.info(options.permanent === true ? 'Permanently deleted sessions' : 'Moved sessions to Recycle Bin', {
      count: result.deletedIds.length
    })
    return result
  }

  /** Move sessions to the Recycle Bin, detach bound tasks, and fail pending deliveries. */
  trashByIdsTx(
    tx: DbOrTx,
    ids: string[],
    options: { requireAll?: boolean; deletedAt?: number } = {}
  ): { trashedIds: string[]; taskScheduleIds: string[]; deliveryResults: AgentSessionMessageEntity[] } {
    const children = chunk(ids, SQLITE_INARRAY_CHUNK).flatMap((idChunk) =>
      tx
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .where(inArray(sessionsTable.ownerSessionId, idChunk))
        .all()
    )
    const uniqueIds = Array.from(new Set([...ids, ...children.map((row) => row.id)]))
    if (uniqueIds.length === 0) return { trashedIds: [], taskScheduleIds: [], deliveryResults: [] }

    const rows = chunk(uniqueIds, SQLITE_INARRAY_CHUNK).flatMap((idChunk) =>
      tx
        .select({ id: sessionsTable.id, taskScheduleId: sessionsTable.taskId })
        .from(sessionsTable)
        .where(and(inArray(sessionsTable.id, idChunk), isNull(sessionsTable.deletedAt)))
        .all()
    )
    const trashedIds = rows.map((row) => row.id)
    if (options.requireAll && trashedIds.length !== uniqueIds.length) {
      const foundIds = new Set(trashedIds)
      const missingId = uniqueIds.find((candidate) => !foundIds.has(candidate)) ?? uniqueIds[0]
      throw DataApiErrorFactory.notFound('Session', missingId)
    }
    if (trashedIds.length === 0) return { trashedIds, taskScheduleIds: [], deliveryResults: [] }

    const deliveryResults = getDataService('AgentSessionMessageService').prepareSessionDeletionTx(tx, trashedIds)
    const taskScheduleIds = rows.flatMap((row) => (row.taskScheduleId ? [row.taskScheduleId] : []))
    // One timestamp for every chunk: restoreTrashedWithAgentTx matches deletedAt exactly.
    const deletedAt = options.deletedAt ?? Date.now()
    for (const idChunk of chunk(trashedIds, SQLITE_INARRAY_CHUNK)) {
      if (taskScheduleIds.length > 0) {
        this.clearTaskReuseTx(tx, and(inArray(sessionsTable.id, idChunk), isNotNull(sessionsTable.taskId))!)
      }
      tx.update(sessionsTable).set({ deletedAt }).where(inArray(sessionsTable.id, idChunk)).run()
    }
    pinService.purgeForEntitiesTx(tx, 'session', trashedIds)
    return { trashedIds, taskScheduleIds, deliveryResults }
  }

  trashByAgentIdTx(
    tx: DbOrTx,
    agentId: string,
    options: { validateAgent?: boolean; deletedAt?: number; sessionTypes?: readonly AgentSessionType[] } = {}
  ): { trashedIds: string[]; taskScheduleIds: string[]; deliveryResults: AgentSessionMessageEntity[] } {
    if (options.validateAgent ?? true) this.assertAgentExistsTx(tx, agentId)
    const ids = tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.agentId, agentId),
          isNull(sessionsTable.deletedAt),
          options.sessionTypes?.length ? inArray(sessionsTable.type, [...options.sessionTypes]) : undefined
        )
      )
      .all()
      .map((row) => row.id)
    return this.trashByIdsTx(tx, ids, {
      deletedAt: options.deletedAt
    })
  }

  /**
   * Restore the sessions trashed together with their agent inside the caller's
   * transaction: `trashByAgentIdTx` stamps them with the agent's own `deletedAt`,
   * so that timestamp scopes the operation. Individually archived sessions carry
   * a different one and stay in the Recycle Bin.
   */
  restoreTrashedWithAgentTx(tx: DbOrTx, agentId: string, trashedAt: number): string[] {
    return tx
      .update(sessionsTable)
      .set({ deletedAt: null })
      .where(and(eq(sessionsTable.agentId, agentId), eq(sessionsTable.deletedAt, trashedAt)))
      .returning({ id: sessionsTable.id })
      .all()
      .map((row) => row.id)
  }

  restore(id: string): AgentSessionEntity {
    const db = application.get('DbService').getDb()

    const [row] = db
      .update(sessionsTable)
      .set({ deletedAt: null, taskId: null, isTaskReuseTarget: false })
      .where(
        and(or(eq(sessionsTable.id, id), eq(sessionsTable.ownerSessionId, id)), isNotNull(sessionsTable.deletedAt))
      )
      .returning({ id: sessionsTable.id })
      .all()
    if (!row) throw DataApiErrorFactory.notFound('Session', id)

    this.notifyReadModelChange([id], 'membership')
    logger.info('Restored session', { id })
    return this.getById(id)
  }

  listExpiredTrashIds(cutoffMs: number, limit: number): string[] {
    return application
      .get('DbService')
      .getDb()
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
      .where(and(isNotNull(sessionsTable.deletedAt), lt(sessionsTable.deletedAt, cutoffMs)))
      .limit(limit)
      .all()
      .map((row) => row.id)
  }

  isExpiredTrash(id: string, cutoffMs: number): boolean {
    return (
      application
        .get('DbService')
        .getDb()
        .select({ id: sessionsTable.id })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(and(eq(sessionsTable.id, id), isNotNull(sessionsTable.deletedAt), lt(sessionsTable.deletedAt, cutoffMs)))
        .limit(1)
        .all().length > 0
    )
  }

  purgeExpiredByIdsTx(tx: DbOrTx, ids: readonly string[], cutoffMs: number): string[] {
    const uniqueIds = [...new Set(ids)]
    if (uniqueIds.length === 0) return []

    const rows = chunk(uniqueIds, SQLITE_INARRAY_CHUNK).flatMap((idChunk) =>
      tx
        .select({ session: sessionsTable, workspace: agentWorkspaceTable })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .where(
          and(
            inArray(sessionsTable.id, idChunk),
            isNotNull(sessionsTable.deletedAt),
            lt(sessionsTable.deletedAt, cutoffMs)
          )
        )
        .all()
    )
    if (rows.length === 0) return []

    const purgedIds = rows.map((row) => row.session.id)
    const systemWorkspaceIds = rows
      .filter((row) => row.session.ownerSessionId === null && row.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM)
      .map((row) => row.workspace.id)
    for (const idChunk of chunk(purgedIds, SQLITE_INARRAY_CHUNK)) {
      tx.delete(sessionsTable).where(inArray(sessionsTable.id, idChunk)).run()
    }
    pinService.purgeForEntitiesTx(tx, 'session', purgedIds)
    for (const workspaceId of systemWorkspaceIds) agentWorkspaceService.deleteByIdTx(tx, workspaceId)
    return purgedIds
  }

  deleteWorkspaceCascade(workspaceId: string): DeleteAgentSessionsResult {
    const result = this.deleteWorkspaceCascadeWithImpact(workspaceId)
    return { deletedIds: result.deletedIds }
  }

  deleteWorkspaceCascadeWithImpact(workspaceId: string): AgentSessionDeletionOutcome {
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
    pinService.notifyPurged()
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

  deleteByAgentId(agentId: string, options: { permanent?: boolean } = {}): DeleteAgentSessionsResult {
    const result = this.deleteByAgentIdWithImpact(agentId, options)
    return { deletedIds: result.deletedIds }
  }

  /** Session type filtering applies only to trash moves; permanent deletion always includes all types. */
  deleteByAgentIdWithImpact(
    agentId: string,
    options: { permanent?: boolean; sessionTypes?: readonly AgentSessionType[] } = {}
  ): AgentSessionDeletionOutcome {
    const deliveryResults: AgentSessionMessageEntity[] = []
    const result = application.get('DbService').withWriteTx((tx) => {
      if (options.permanent !== true) {
        const trashed = this.trashByAgentIdTx(tx, agentId, { sessionTypes: options.sessionTypes })
        deliveryResults.push(...trashed.deliveryResults)
        return { deletedIds: trashed.trashedIds, taskScheduleIds: trashed.taskScheduleIds, deliveryResults }
      }
      const taskScheduleIds = this.getTaskScheduleIdsForAgentTx(tx, agentId)
      const deletedIds = this.deleteByAgentIdTx(tx, agentId, { deliveryResults })
      return { deletedIds, taskScheduleIds, deliveryResults }
    })

    publishTaskReadModelChanges(result.taskScheduleIds)
    getDataService('AgentSessionMessageService').publishDeliveryChanges(result.deliveryResults)
    this.notifyReadModelChange(result.deletedIds, 'membership')
    if (result.deletedIds.length > 0) pinService.notifyPurged()
    logger.info(
      options.permanent === true ? 'Permanently deleted agent sessions' : 'Moved agent sessions to Recycle Bin',
      {
        agentId,
        count: result.deletedIds.length
      }
    )
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
      .orderBy(asc(sessionsTable.id))
      .all()
      .map((row) => row.id)
  }

  listIdsByAgent(agentId: string): string[] {
    return this.listIdsByAgentTx(application.get('DbService').getDb(), agentId)
  }

  listSystemWorkspaceSessions(ids?: readonly string[]) {
    if (ids?.length === 0) return []
    const db = application.get('DbService').getDb()
    const select = (idChunk?: string[]) =>
      db
        .select({
          id: sessionsTable.id,
          path: agentWorkspaceTable.path,
          deletedAt: sessionsTable.deletedAt,
          agentDeletedAt: agentsTable.deletedAt
        })
        .from(sessionsTable)
        .innerJoin(agentWorkspaceTable, eq(sessionsTable.workspaceId, agentWorkspaceTable.id))
        .leftJoin(agentsTable, eq(sessionsTable.agentId, agentsTable.id))
        .where(
          and(
            eq(agentWorkspaceTable.type, AGENT_WORKSPACE_TYPE.SYSTEM),
            isNull(sessionsTable.ownerSessionId),
            idChunk ? inArray(sessionsTable.id, idChunk) : undefined
          )
        )
        .all()
    return ids ? chunk([...ids], SQLITE_INARRAY_CHUNK).flatMap(select) : select()
  }

  listIdsByWorkspace(workspaceId: string): string[] {
    return application
      .get('DbService')
      .getDb()
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(eq(sessionsTable.workspaceId, workspaceId))
      .orderBy(asc(sessionsTable.id))
      .all()
      .map((row) => row.id)
  }

  listActiveIdsByAgent(agentId: string, options: { sessionTypes?: readonly AgentSessionType[] } = {}): string[] {
    return application
      .get('DbService')
      .getDb()
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(
        and(
          eq(sessionsTable.agentId, agentId),
          isNull(sessionsTable.deletedAt),
          options.sessionTypes?.length ? inArray(sessionsTable.type, [...options.sessionTypes]) : undefined
        )
      )
      .orderBy(asc(sessionsTable.id))
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
      // Only the root owns a shared system workspace; child deletion must not remove it.
      if (row.session.ownerSessionId === null && row.workspace.type === AGENT_WORKSPACE_TYPE.SYSTEM) {
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
    return chunk([...new Set(sessionIds)], SQLITE_INARRAY_CHUNK)
      .flatMap((idChunk) =>
        tx
          .select({ taskScheduleId: sessionsTable.taskId })
          .from(sessionsTable)
          .where(and(inArray(sessionsTable.id, idChunk), isNotNull(sessionsTable.taskId)))
          .all()
      )
      .flatMap((row) => (row.taskScheduleId ? [row.taskScheduleId] : []))
  }

  private getTaskScheduleIdsForWorkspaceTx(tx: DbOrTx, workspaceId: string): string[] {
    return tx
      .select({ taskScheduleId: sessionsTable.taskId })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.workspaceId, workspaceId), isNotNull(sessionsTable.taskId)))
      .all()
      .flatMap((row) => (row.taskScheduleId ? [row.taskScheduleId] : []))
  }

  getTaskScheduleIdsForAgentTx(tx: DbOrTx, agentId: string): string[] {
    return tx
      .select({ taskScheduleId: sessionsTable.taskId })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.agentId, agentId), isNotNull(sessionsTable.taskId)))
      .all()
      .flatMap((row) => (row.taskScheduleId ? [row.taskScheduleId] : []))
  }

  private deleteByIdsTx(tx: DbOrTx, ids: string[]): string[] {
    const uniqueIds = Array.from(new Set(ids))
    if (uniqueIds.length === 0) return []

    const deletedIds = chunk(uniqueIds, SQLITE_INARRAY_CHUNK).flatMap((idChunk) =>
      tx
        .delete(sessionsTable)
        .where(inArray(sessionsTable.id, idChunk))
        .returning({ id: sessionsTable.id })
        .all()
        .map((row) => row.id)
    )

    pinService.purgeForEntitiesTx(tx, 'session', deletedIds)
    return deletedIds
  }

  reorder(id: string, anchor: OrderRequest): void {
    application.get('DbService').withWriteTx((tx) => this.reorderTx(tx, id, anchor))
    this.sessionUpdated.fire({ sessionId: id })
  }

  reorderTx(tx: DbOrTx, id: string, anchor: OrderRequest): void {
    const [target] = tx
      .select({ id: sessionsTable.id })
      .from(sessionsTable)
      .where(and(eq(sessionsTable.id, id), isNull(sessionsTable.deletedAt)))
      .limit(1)
      .all()
    if (!target) throw DataApiErrorFactory.notFound('Session', id)

    applyMoves(tx, sessionsTable, [{ id, anchor }], {
      pkColumn: sessionsTable.id,
      scope: isNull(sessionsTable.deletedAt)
    })
  }

  reorderBatch(moves: Array<{ id: string; anchor: OrderRequest }>): void {
    if (moves.length === 0) return
    application.get('DbService').withWriteTx((tx) => this.reorderBatchTx(tx, moves))
    for (const id of new Set(moves.map((move) => move.id))) this.sessionUpdated.fire({ sessionId: id })
  }

  reorderBatchTx(tx: DbOrTx, moves: Array<{ id: string; anchor: OrderRequest }>): void {
    applyMoves(tx, sessionsTable, moves, { pkColumn: sessionsTable.id, scope: isNull(sessionsTable.deletedAt) })
  }
}

export const agentSessionService = new AgentSessionService()
