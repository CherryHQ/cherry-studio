import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable as sessionTable } from '@data/db/schemas/agentSession'
import {
  type AgentSessionMessageRow as SessionMessageRow,
  agentSessionMessageTable as sessionMessagesTable,
  type InsertAgentSessionMessageRow as InsertSessionMessageRow
} from '@data/db/schemas/agentSessionMessage'
import { fileEntryTable } from '@data/db/schemas/file'
import { agentSessionMessageFileRefTable } from '@data/db/schemas/fileRelations'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { agentSessionReadModelEffects, agentSessionService } from '@data/services/AgentSessionService'
import { registerDataService } from '@data/services/dataServiceRegistry'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { buildSearchSnippet } from '@main/utils/searchSnippet'
import {
  extractFtsTokens,
  extractMatchTerms,
  extractShortTerms,
  needsLikeFallback,
  toFtsLikePattern,
  toFtsMatchQuery
} from '@main/utils/trigramFtsQuery'
import {
  AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES,
  type AgentSessionDeliveryEnvelope,
  type AgentSessionDeliveryError,
  type AgentSessionDeliveryOutcome,
  type AgentSessionDeliveryReplyPolicy,
  type AgentSessionDeliveryStatus
} from '@shared/ai/agentSessionDelivery'
import { applyApprovalDecisions, type ApprovalDecision } from '@shared/ai/transport'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import type {
  AgentSessionMessageEntity,
  CreateAgentSessionMessageDto,
  CreateAgentSessionMessagesDto,
  UpdateAgentSessionMessageDto
} from '@shared/data/api/schemas/agentSessionMessages'
import {
  AGENT_SESSION_MESSAGES_DEFAULT_LIMIT,
  AGENT_SESSION_MESSAGES_MAX_LIMIT
} from '@shared/data/api/schemas/agentSessionMessages'
import type { AgentSessionEntity } from '@shared/data/api/schemas/agentSessions'
import type { AgentSessionWorkspaceSource } from '@shared/data/api/schemas/agentWorkspaces'
import type { SessionMessageContentSearchItem } from '@shared/data/api/schemas/search'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import {
  AGENT_SESSION_MESSAGE_SEARCH_ROLES,
  type CherryMessagePart,
  coerceSearchRole,
  type MessageRuntimeStatsInput
} from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { isToolUIPart } from 'ai'
import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, or, type SQL, sql } from 'drizzle-orm'
import { v4 as uuidv4, v7 as uuidv7, validate as isUuid } from 'uuid'

import { aiUsageRecordService, mergeMessageRuntimeStats } from './AiUsageRecordService'
import { isAssistantActivityTransition, isConversationActivityRole } from './utils/activityTime'
import { type SearchFetchContext, searchWithCursor } from './utils/ftsSearch'
import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

const logger = loggerService.withContext('AgentSessionMessageService')
const SQLITE_INARRAY_CHUNK = 500
// A ranked tool search runs synchronously on Main. Cap evidence scanning at 20 pages per requested
// result; raise this only if relevance telemetry shows valid Sessions routinely beyond the ceiling.
const RANKED_SESSION_SEARCH_SCAN_MULTIPLIER = 20
// SQLite's default expression-depth ceiling is 1,000. Keep pure-LIKE fallback comfortably below it.
const RANKED_SESSION_SEARCH_MAX_FALLBACK_TERMS = 128
const MESSAGE_CURSOR_CONFIG = {
  fieldMessage: 'must be a valid message cursor',
  errorMessage: 'Invalid message cursor'
}

export interface AgentSessionMessageRangeMetadata {
  readonly createdAt: string
  readonly entityJsonBytes: number
  readonly id: string
  readonly sessionId: string
}

function agentSessionMessageEntityJsonBytes(): SQL<number> {
  return sql<number>`length(cast(json_object(
    'id', ${sessionMessagesTable.id},
    'sessionId', ${sessionMessagesTable.sessionId},
    'role', ${sessionMessagesTable.role},
    'data', json(${sessionMessagesTable.data}),
    'searchableText', ${sessionMessagesTable.searchableText},
    'status', ${sessionMessagesTable.status},
    'modelId', ${sessionMessagesTable.modelId},
    'messageSnapshot', json(${sessionMessagesTable.messageSnapshot}),
    'stats', json(${sessionMessagesTable.stats}),
    'runtimeResumeToken', ${sessionMessagesTable.runtimeResumeToken},
    'delivery', json(case
      when ${sessionMessagesTable.delivery} is not null and ${sessionMessagesTable.deliveryStatus} is not null
      then json_set(
        json(${sessionMessagesTable.delivery}),
        '$.status', ${sessionMessagesTable.deliveryStatus},
        '$.inReplyTo', ${sessionMessagesTable.deliveryInReplyTo},
        '$.turnRef', ${sessionMessagesTable.deliveryTurnRef}
      )
      else null
    end),
    'createdAt', strftime('%Y-%m-%dT%H:%M:%fZ', ${sessionMessagesTable.createdAt} / 1000.0, 'unixepoch'),
    'updatedAt', strftime('%Y-%m-%dT%H:%M:%fZ', ${sessionMessagesTable.updatedAt} / 1000.0, 'unixepoch')
  ) as blob))`
}

type SessionMessageSearchRow = {
  rowId: string
  sessionId: string
  sessionName: string
  agentId: string | null
  agentName: string | null
  role: string
  searchableText: string
  createdAt: number
}

type SessionMessageContentSearchInput = {
  q: string
  cursor?: string
  limit?: number
  createdAtFrom?: string
  sessionId?: string
}

type RankedSessionMessageSearchInput = {
  q: string
  limit?: number
  agentId?: string
  addressableOnly?: boolean
}

type ListSessionMessagesOptions = {
  cursor?: string
  limit?: number
  messageId?: string
}

type SaveAgentSessionMessageParams = {
  sessionId: string
  runtimeResumeToken?: string
  runtimeStats?: MessageRuntimeStatsInput
  message: CreateAgentSessionMessageDto & {
    delivery?: AgentSessionDeliveryEnvelope
    deliveryStatus?: AgentSessionDeliveryStatus
    deliveryTurnRef?: string | null
    deliveryInReplyTo?: string | null
    deliverySenderSessionId?: string | null
  }
}

function mapSessionMessageSearchRow(row: SessionMessageSearchRow, snippet: string): SessionMessageContentSearchItem {
  return {
    messageId: row.rowId,
    sessionId: row.sessionId,
    sessionName: row.sessionName,
    agentId: row.agentId ?? undefined,
    agentName: row.agentName ?? undefined,
    role: coerceSearchRole(row.role, AGENT_SESSION_MESSAGE_SEARCH_ROLES),
    snippet,
    createdAt: timestampToISO(Number(row.createdAt))
  }
}

export const AGENT_SESSION_DELIVERY_ERROR_CODES = {
  SENDER_FORBIDDEN: 'SENDER_FORBIDDEN',
  SESSION_TOOL_FORBIDDEN: 'SESSION_TOOL_FORBIDDEN',
  TARGET_AGENT_DELETED: 'TARGET_AGENT_DELETED',
  TARGET_SESSION_NOT_FOUND: 'TARGET_SESSION_NOT_FOUND',
  TARGET_SESSION_ORPHANED: 'TARGET_SESSION_ORPHANED',
  TARGET_UNAVAILABLE: 'TARGET_UNAVAILABLE',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  TURN_START_INTERRUPTED: 'TURN_START_INTERRUPTED',
  DELIVERY_TURN_DELETED: 'DELIVERY_TURN_DELETED',
  CANCELLED: 'CANCELLED',
  TARGET_SESSION_DELETED: 'TARGET_SESSION_DELETED',
  CALLER_SESSION_DELETED: 'CALLER_SESSION_DELETED'
} as const

export type AgentSessionDeliveryErrorCode =
  (typeof AGENT_SESSION_DELIVERY_ERROR_CODES)[keyof typeof AGENT_SESSION_DELIVERY_ERROR_CODES]

export class AgentSessionDeliveryRoutingError extends Error {
  constructor(
    readonly code: AgentSessionDeliveryErrorCode,
    message: string
  ) {
    super(message)
    this.name = 'AgentSessionDeliveryRoutingError'
  }
}

type SaveAgentSessionMessageOptions =
  | { db: DbOrTx; publishDataChange?: never }
  | { db?: undefined; publishDataChange?: boolean }

type SavedAgentSessionMessage = {
  entity: AgentSessionMessageEntity
  dataChange: 'membership' | 'projection'
  activityTimestamp: number | null
}

function replaceAgentSessionMessageFileRefsTx(
  tx: DbOrTx,
  messageId: string,
  data: AgentSessionMessageEntity['data']
): void {
  tx.delete(agentSessionMessageFileRefTable).where(eq(agentSessionMessageFileRefTable.sourceId, messageId)).run()

  const ids = [
    ...new Set(
      (data.parts ?? [])
        .filter((part) => part.type === 'file')
        .map((part) => readCherryMeta(part)?.fileEntryId)
        .filter((id): id is string => Boolean(id))
    )
  ]
  if (ids.length === 0) return

  const existingIds = new Set<string>()
  for (let index = 0; index < ids.length; index += SQLITE_INARRAY_CHUNK) {
    const rows = tx
      .select({ id: fileEntryTable.id })
      .from(fileEntryTable)
      .where(inArray(fileEntryTable.id, ids.slice(index, index + SQLITE_INARRAY_CHUNK)))
      .all()
    rows.forEach((row) => existingIds.add(row.id))
  }

  const now = Date.now()
  const rows = ids
    .filter((fileEntryId) => existingIds.has(fileEntryId))
    .map((fileEntryId) => ({
      fileEntryId,
      sourceId: messageId,
      role: 'attachment' as const,
      createdAt: now,
      updatedAt: now
    }))

  if (rows.length !== ids.length) {
    logger.warn('Dropped agent-session message file refs without matching file_entry', {
      messageId,
      dropped: ids.length - rows.length,
      total: ids.length
    })
  }

  for (let index = 0; index < rows.length; index += SQLITE_INARRAY_CHUNK) {
    tx.insert(agentSessionMessageFileRefTable)
      .values(rows.slice(index, index + SQLITE_INARRAY_CHUNK))
      .run()
  }
}

function terminalResultData(
  message: SessionMessageRow | null,
  outcome: AgentSessionDeliveryOutcome,
  error?: AgentSessionDeliveryError | null
): AgentSessionMessageEntity['data'] {
  const parts = (message?.data.parts ?? []).flatMap((part): CherryMessagePart[] => {
    if (part.type === 'text') return [{ type: 'text', text: part.text }]
    if (part.type === 'file' && readCherryMeta(part)?.fileEntryId) return [structuredClone(part)]
    return []
  })
  if (parts.length > 0) return { parts }

  const text =
    error?.message ??
    (outcome === 'success'
      ? 'Session completed without a text response.'
      : outcome === 'interrupted'
        ? 'Session was interrupted before producing a result.'
        : 'Session failed without a text response.')
  return { parts: [{ type: 'text', text }] }
}

export class AgentSessionMessageService {
  search(query: SessionMessageContentSearchInput) {
    const db = application.get('DbService').getDb()
    const messageSessionCondition = query.sessionId ? sql`sm.session_id = ${query.sessionId}` : sql`1 = 1`

    return searchWithCursor<SessionMessageSearchRow, SessionMessageContentSearchItem>({
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
      createdAtFrom: query.createdAtFrom,
      cursorConfig: MESSAGE_CURSOR_CONFIG,
      fetchRows: ({ ftsConditions, cursor, createdAtFromMs, offset, chunkSize }: SearchFetchContext) => {
        const createdAtCondition = createdAtFromMs !== undefined ? sql`sm.created_at >= ${createdAtFromMs}` : sql`1 = 1`

        return db.all<SessionMessageSearchRow>(sql`
          SELECT
            sm.id AS "rowId",
            sm.searchable_text AS "searchableText",
            sm.session_id AS "sessionId",
            s.name AS "sessionName",
            s.agent_id AS "agentId",
            a.name AS "agentName",
            sm.role,
            sm.created_at AS "createdAt"
          FROM agent_session_message sm
          JOIN agent_session_message_fts fts ON sm.fts_rowid = fts.rowid
          JOIN agent_session s ON s.id = sm.session_id
          LEFT JOIN agent a ON a.id = s.agent_id
          WHERE sm.searchable_text != ''
            AND ${messageSessionCondition}
            AND ${createdAtCondition}
            AND ${sql.join(ftsConditions, sql` AND `)}
            AND ${
              cursor
                ? sql`(sm.created_at < ${cursor.createdAt} OR (sm.created_at = ${cursor.createdAt} AND sm.id < ${cursor.id}))`
                : sql`1 = 1`
            }
          ORDER BY sm.created_at DESC, sm.id DESC
          LIMIT ${chunkSize}
          OFFSET ${offset}
        `)
      },
      getSearchableText: (row) => row.searchableText,
      buildSnippet: buildSearchSnippet,
      mapRow: (row, { snippet }) => ({
        item: mapSessionMessageSearchRow(row, snippet),
        sort: {
          createdAt: Number(row.createdAt),
          id: row.rowId
        }
      })
    })
  }

  /** BM25-ranked search for the Agent tool; ordinary DataApi search keeps its chronological cursor contract. */
  searchRanked(query: RankedSessionMessageSearchInput): SessionMessageContentSearchItem[] {
    const database = application.get('DbService').getDb()
    const limit = Math.min(Math.max(Math.trunc(query.limit ?? 20), 1), 100)
    const agentCondition = query.agentId ? sql`s.agent_id = ${query.agentId}` : sql`1 = 1`
    const addressableCondition = query.addressableOnly
      ? sql`s.agent_id IS NOT NULL AND a.id IS NOT NULL AND a.deleted_at IS NULL`
      : sql`1 = 1`
    const matchQuery = toFtsMatchQuery(query.q)
    const snippetTerms = [...extractMatchTerms(query.q), ...extractShortTerms(query.q)]

    const fetchMatchRows = (shortTerms: string[], chunkLimit: number, offset: number): SessionMessageSearchRow[] => {
      if (!matchQuery) return []
      const shortTermConditions = shortTerms.map(
        (term) => sql`sm.searchable_text LIKE ${toFtsLikePattern(term)} ESCAPE '\\'`
      )
      return database.all<SessionMessageSearchRow>(sql`
        SELECT
          sm.id AS "rowId",
          sm.searchable_text AS "searchableText",
          sm.session_id AS "sessionId",
          s.name AS "sessionName",
          s.agent_id AS "agentId",
          a.name AS "agentName",
          sm.role,
          sm.created_at AS "createdAt"
        FROM agent_session_message_fts
        JOIN agent_session_message sm ON sm.fts_rowid = agent_session_message_fts.rowid
        JOIN agent_session s ON s.id = sm.session_id
        LEFT JOIN agent a ON a.id = s.agent_id
        WHERE agent_session_message_fts MATCH ${matchQuery}
          AND ${agentCondition}
          AND ${addressableCondition}
          ${shortTermConditions.length > 0 ? sql`AND ${sql.join(shortTermConditions, sql` AND `)}` : sql``}
        ORDER BY bm25(agent_session_message_fts), sm.created_at DESC, sm.id DESC
        LIMIT ${chunkLimit}
        OFFSET ${offset}
      `)
    }

    const collectDistinctSessions = (
      fetchRows: (chunkLimit: number, offset: number) => SessionMessageSearchRow[]
    ): SessionMessageSearchRow[] => {
      const rows: SessionMessageSearchRow[] = []
      const seenSessionIds = new Set<string>()
      const chunkLimit = Math.max(limit, 20)
      const scanLimit = chunkLimit * RANKED_SESSION_SEARCH_SCAN_MULTIPLIER
      let offset = 0
      while (rows.length < limit && offset < scanLimit) {
        const chunk = fetchRows(Math.min(chunkLimit, scanLimit - offset), offset)
        for (const row of chunk) {
          if (seenSessionIds.has(row.sessionId)) continue
          seenSessionIds.add(row.sessionId)
          rows.push(row)
          if (rows.length === limit) break
        }
        if (chunk.length < chunkLimit) break
        offset += chunk.length
      }
      return rows
    }

    let rows: SessionMessageSearchRow[]
    if (needsLikeFallback(query.q)) {
      const terms = [...new Set(extractFtsTokens(query.q))].slice(0, RANKED_SESSION_SEARCH_MAX_FALLBACK_TERMS)
      if (terms.length === 0) return []
      const conditions = terms.map((term) => sql`sm.searchable_text LIKE ${toFtsLikePattern(term)} ESCAPE '\\'`)
      rows = collectDistinctSessions((chunkLimit, offset) =>
        database.all<SessionMessageSearchRow>(sql`
          SELECT
            sm.id AS "rowId",
            sm.searchable_text AS "searchableText",
            sm.session_id AS "sessionId",
            s.name AS "sessionName",
            s.agent_id AS "agentId",
            a.name AS "agentName",
            sm.role,
            sm.created_at AS "createdAt"
          FROM agent_session_message sm
          JOIN agent_session s ON s.id = sm.session_id
          LEFT JOIN agent a ON a.id = s.agent_id
          WHERE ${agentCondition}
            AND ${addressableCondition}
            AND ${sql.join(conditions, sql` AND `)}
          ORDER BY length(sm.searchable_text), sm.created_at DESC, sm.id DESC
          LIMIT ${chunkLimit}
          OFFSET ${offset}
        `)
      )
      return rows.map((row) =>
        mapSessionMessageSearchRow(row, buildSearchSnippet(row.searchableText, terms, 'substring'))
      )
    }

    const shortTerms = extractShortTerms(query.q)
    rows = collectDistinctSessions((chunkLimit, offset) => fetchMatchRows(shortTerms, chunkLimit, offset))
    if (rows.length === 0 && shortTerms.length > 0) {
      rows = collectDistinctSessions((chunkLimit, offset) => fetchMatchRows([], chunkLimit, offset))
    }
    return rows.map((row) =>
      mapSessionMessageSearchRow(row, buildSearchSnippet(row.searchableText, snippetTerms, 'substring'))
    )
  }

  /**
   * Lightweight existence check used to distinguish an untouched session's
   * initial turn without loading a potentially large message payload.
   */
  hasSessionMessages(sessionId: string, excludingMessageId?: string): boolean {
    const database = application.get('DbService').getDb()
    return (
      database
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            excludingMessageId ? ne(sessionMessagesTable.id, excludingMessageId) : undefined
          )
        )
        .limit(1)
        .all().length > 0
    )
  }

  hasSessionMessage(sessionId: string, messageId: string): boolean {
    return this.findExistingMessageRow(application.get('DbService').getDb(), sessionId, messageId) !== null
  }

  listCreatedInRangeMetadataPage({
    fromMs,
    toMs,
    cursor: rawCursor,
    limit
  }: {
    fromMs: number
    toMs: number
    cursor?: string
    limit: number
  }): CursorPaginationResponse<AgentSessionMessageRangeMetadata> {
    const ordering = keysetOrdering(sessionMessagesTable.createdAt, sessionMessagesTable.id, {
      major: 'desc',
      tie: 'asc'
    })
    const cursor = decodeListCursor(rawCursor, asNumericKey, 'agent-session-message-range-metadata')
    const rows = application
      .get('DbService')
      .getDb()
      .select({
        createdAt: sessionMessagesTable.createdAt,
        entityJsonBytes: agentSessionMessageEntityJsonBytes(),
        id: sessionMessagesTable.id,
        sessionId: sessionMessagesTable.sessionId
      })
      .from(sessionMessagesTable)
      .where(
        and(
          gte(sessionMessagesTable.createdAt, fromMs),
          lte(sessionMessagesTable.createdAt, toMs),
          cursor ? ordering.where(cursor) : undefined
        )
      )
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()

    const hasNext = rows.length > limit
    const pageRows = hasNext ? rows.slice(0, limit) : rows
    const tail = pageRows[pageRows.length - 1]
    return {
      items: pageRows.map((row) => ({ ...row, createdAt: timestampToISO(row.createdAt) })),
      nextCursor: hasNext && tail ? encodeCursor(tail.createdAt, tail.id) : undefined
    }
  }

  /**
   * Cursor-paginated message read. Walks newest-first; an absent cursor
   * returns the most recent page, each `nextCursor` walks one page older.
   * Cursor wire format: `<createdAtMs>:<id>` — composite (createdAt, id) so
   * the secondary key tiebreaks ties from the ms-precision timestamp.
   */
  listSessionMessages(
    sessionId: string,
    options: ListSessionMessagesOptions = {}
  ): CursorPaginationResponse<AgentSessionMessageEntity> {
    const database = application.get('DbService').getDb()

    const [session] = database
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
      .all()
    if (!session) throw DataApiErrorFactory.notFound('Session', sessionId)

    const limit = Math.min(options.limit ?? AGENT_SESSION_MESSAGES_DEFAULT_LIMIT, AGENT_SESSION_MESSAGES_MAX_LIMIT)
    const ordering = keysetOrdering(sessionMessagesTable.createdAt, sessionMessagesTable.id, {
      major: 'desc',
      tie: 'desc'
    })
    const cursor = decodeListCursor(options.cursor, asNumericKey, 'agent-session-message')
    const [anchor] =
      !options.cursor && options.messageId
        ? database
            .select({ id: sessionMessagesTable.id, createdAt: sessionMessagesTable.createdAt })
            .from(sessionMessagesTable)
            .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, options.messageId)))
            .limit(1)
            .all()
        : []
    if (!options.cursor && options.messageId && !anchor) {
      logger.warn('Session message anchor not found, falling back to newest page', {
        sessionId,
        messageId: options.messageId
      })
    }

    const filters = [eq(sessionMessagesTable.sessionId, sessionId)]
    if (cursor) {
      filters.push(ordering.where(cursor))
    } else if (anchor) {
      // Anchor the first page so previews include the matched message and older context.
      filters.push(
        or(
          lt(sessionMessagesTable.createdAt, anchor.createdAt),
          and(eq(sessionMessagesTable.createdAt, anchor.createdAt), lte(sessionMessagesTable.id, anchor.id))
        )!
      )
    }

    const rows = database
      .select()
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(...ordering.orderBy)
      .limit(limit + 1)
      .all()

    const hasNext = rows.length > limit
    const pageRows = hasNext ? rows.slice(0, limit) : rows
    const items = pageRows.map((row) => this.rowToEntity(row))
    const tail = pageRows[pageRows.length - 1]
    const nextCursor = hasNext && tail ? encodeCursor(tail.createdAt, tail.id) : undefined

    return { items, nextCursor }
  }

  deleteSessionMessage(sessionId: string, messageId: string): void {
    if (!messageId) {
      throw DataApiErrorFactory.validation({ messageId: ['must not be empty'] })
    }
    const database = application.get('DbService').getDb()

    const [session] = database
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
      .all()
    if (!session) throw DataApiErrorFactory.notFound('Session', sessionId)

    const existing = this.findExistingMessageRow(database, sessionId, messageId)
    if (existing?.deliveryStatus === 'accepted' || existing?.deliveryStatus === 'delivering') {
      throw DataApiErrorFactory.resourceLocked('Message', messageId, 'an in-flight Session delivery')
    }

    const result = withSqliteErrors(
      () => this.deleteSessionMessageTx(database, sessionId, messageId),
      defaultHandlersFor('Message', messageId)
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Message', messageId)
    }
  }

  getSessionMessage(sessionId: string, messageId: string): AgentSessionMessageEntity {
    const database = application.get('DbService').getDb()
    const row = this.findExistingMessageRow(database, sessionId, messageId)
    if (!row) throw DataApiErrorFactory.notFound('Message', messageId)
    return this.rowToEntity(row)
  }

  updateSessionMessage(
    sessionId: string,
    messageId: string,
    dto: UpdateAgentSessionMessageDto
  ): AgentSessionMessageEntity {
    return application.get('DbService').withWriteTx((tx) => {
      const existing = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existing) throw DataApiErrorFactory.notFound('Message', messageId)

      const updatedAt = Date.now()
      // PATCH callers send partial data (usually just parts); shallow-merge so
      // omitted keys like main-authoritative turnOptions survive the update.
      const mergedData = { ...existing.data, ...dto.data }
      const [updated] = tx
        .update(sessionMessagesTable)
        .set({ data: mergedData, updatedAt })
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .returning()
        .all()
      replaceAgentSessionMessageFileRefsTx(tx, messageId, mergedData)
      agentSessionService.touchUpdatedAtTx(tx, sessionId, updatedAt)
      return this.rowToEntity(updated)
    })
  }

  deleteSessionMessageTx(tx: DbOrTx, sessionId: string, messageId: string): { rowsAffected: number } {
    const result = tx
      .delete(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
      .run()
    return { rowsAffected: result.changes }
  }

  /** Assistant rows whose in-memory owner cannot survive a main-process restart. */
  findCrashOrphanedAssistantMessages(): Array<{
    id: string
    sessionId: string
    data: AgentSessionMessageEntity['data']
  }> {
    const database = application.get('DbService').getDb()
    return database
      .select({
        id: sessionMessagesTable.id,
        sessionId: sessionMessagesTable.sessionId,
        data: sessionMessagesTable.data
      })
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.role, 'assistant'),
          or(
            eq(sessionMessagesTable.status, 'pending'),
            sql<boolean>`exists (
              select 1 from json_each(${sessionMessagesTable.data}, '$.parts') as part
              where json_extract(part.value, '$.state') = 'approval-requested'
            )`
          ),
          sql`NOT EXISTS (
            SELECT 1 FROM agent_session_message AS delivery_message
            WHERE delivery_message.delivery_status = 'delivering'
              AND delivery_message.delivery_turn_ref = ${sessionMessagesTable.id}
          )`
        )
      )
      .all()
  }

  /**
   * Boot reconcile of crash-orphaned `pending` rows: resolve each row to `error` (with the
   * caller's terminalized `data`) and discard the affected sessions' resume tokens, atomically.
   * A crashed turn leaves the external CLI session in an untrusted state — resuming it can replay
   * a runaway execution (#18281) — so the next connection must start without a token.
   */
  resolveCrashOrphanedMessages(
    messages: Array<{ id: string; data: AgentSessionMessageEntity['data'] }>,
    sessionIds: string[]
  ): void {
    if (messages.length === 0) return
    application.get('DbService').withWriteTx((tx) => {
      const updatedAt = Date.now()
      for (const message of messages) {
        tx.update(sessionMessagesTable)
          .set({ status: 'error', data: message.data, updatedAt })
          .where(eq(sessionMessagesTable.id, message.id))
          .run()
      }
      if (sessionIds.length > 0) {
        tx.update(sessionMessagesTable)
          .set({ runtimeResumeToken: null })
          .where(inArray(sessionMessagesTable.sessionId, sessionIds))
          .run()
      }
    })
  }

  /** Best-effort terminalization after a live assistant persistence failure. */
  markAssistantMessageTerminalError(sessionId: string, messageId: string): void {
    const changed = application.get('DbService').withWriteTx((tx) => {
      const result = tx
        .update(sessionMessagesTable)
        .set({ status: 'error', updatedAt: Date.now() })
        .where(
          and(
            eq(sessionMessagesTable.sessionId, sessionId),
            eq(sessionMessagesTable.id, messageId),
            eq(sessionMessagesTable.role, 'assistant'),
            eq(sessionMessagesTable.status, 'pending')
          )
        )
        .run()
      return result
    })
    if (changed.changes > 0) this.publishDeliveryChange(sessionId, messageId, 'projection')
  }

  private rowToEntity(row: SessionMessageRow): AgentSessionMessageEntity {
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as AgentSessionMessageEntity['role'],
      data: row.data,
      searchableText: row.searchableText,
      status: row.status as AgentSessionMessageEntity['status'],
      modelId: row.modelId,
      messageSnapshot: row.messageSnapshot,
      stats: row.stats,
      runtimeResumeToken: row.runtimeResumeToken,
      delivery:
        row.delivery && row.deliveryStatus
          ? {
              ...row.delivery,
              status: row.deliveryStatus,
              inReplyTo: row.deliveryInReplyTo,
              turnRef: row.deliveryTurnRef
            }
          : null,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  getLastRuntimeResumeToken(sessionId: string): string | null {
    try {
      const database = application.get('DbService').getDb()
      const result = database
        .select({ runtimeResumeToken: sessionMessagesTable.runtimeResumeToken })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), isNotNull(sessionMessagesTable.runtimeResumeToken)))
        .orderBy(desc(sessionMessagesTable.createdAt))
        .limit(1)
        .all()

      logger.silly('Last runtime resume token result:', {
        runtimeResumeToken: result[0]?.runtimeResumeToken,
        sessionId
      })
      return result[0]?.runtimeResumeToken ?? null
    } catch (error) {
      logger.error('Failed to get last runtime resume token', {
        sessionId,
        error
      })
      throw error
    }
  }

  /**
   * Every resume token still claimed by a session row — the keep-set for the
   * agent orphan sweep. Trashed sessions are included (their message rows
   * survive), so a trashed session's runtime state is only reclaimed once the
   * session is purged and the FK cascade drops its tokens.
   */
  listAllRuntimeResumeTokens(): Set<string> {
    const rows = application
      .get('DbService')
      .getDb()
      .selectDistinct({ runtimeResumeToken: sessionMessagesTable.runtimeResumeToken })
      .from(sessionMessagesTable)
      .where(isNotNull(sessionMessagesTable.runtimeResumeToken))
      .all()
    return new Set(rows.flatMap((row) => (row.runtimeResumeToken ? [row.runtimeResumeToken] : [])))
  }

  // ── Persistence methods ──────────────────────────────────────────

  private findExistingMessageRow(db: DbOrTx, sessionId: string, messageId: string): SessionMessageRow | null {
    const rows = db
      .select()
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, messageId)))
      .limit(1)
      .all()

    return rows[0] ?? null
  }

  private upsertMessage(
    db: DbOrTx,
    params: SaveAgentSessionMessageParams,
    timestampMs = Date.now()
  ): SavedAgentSessionMessage {
    const { sessionId, runtimeResumeToken = null, runtimeStats, message } = params
    const messageId = message.id ?? uuidv7()
    const status = message.status ?? 'success'

    if (!message.role) {
      throw DataApiErrorFactory.validation({ role: ['is required'] }, 'Message payload missing role')
    }

    if (!isUuid(messageId)) {
      throw DataApiErrorFactory.validation({ id: ['must be a UUID'] }, 'Agent session message id must be a UUID')
    }

    const existingRow = this.findExistingMessageRow(db, sessionId, messageId)

    if (existingRow) {
      const runtimeResumeTokenToPersist = runtimeResumeToken ?? existingRow.runtimeResumeToken ?? null
      const updatedAtMs = timestampMs
      const modelId = message.modelId === undefined ? existingRow.modelId : message.modelId
      const messageSnapshot =
        message.messageSnapshot === undefined ? existingRow.messageSnapshot : message.messageSnapshot
      const stats = mergeMessageRuntimeStats(existingRow.stats, runtimeStats) ?? null
      const delivery = message.delivery === undefined ? existingRow.delivery : message.delivery
      const deliveryStatus = message.deliveryStatus === undefined ? existingRow.deliveryStatus : message.deliveryStatus
      const deliveryTurnRef =
        message.deliveryTurnRef === undefined ? existingRow.deliveryTurnRef : message.deliveryTurnRef
      const deliveryInReplyTo =
        message.deliveryInReplyTo === undefined ? existingRow.deliveryInReplyTo : message.deliveryInReplyTo
      const deliverySenderSessionId =
        message.deliverySenderSessionId === undefined
          ? existingRow.deliverySenderSessionId
          : message.deliverySenderSessionId
      const activityTimestamp = isAssistantActivityTransition({
        existingStatus: existingRow.status,
        role: message.role,
        status
      })
        ? timestampMs
        : null

      withSqliteErrors(
        () =>
          db
            .update(sessionMessagesTable)
            .set({
              role: message.role,
              status,
              data: message.data,
              modelId,
              messageSnapshot,
              stats,
              runtimeResumeToken: runtimeResumeTokenToPersist,
              delivery,
              deliveryStatus,
              deliveryTurnRef,
              deliveryInReplyTo,
              deliverySenderSessionId,
              updatedAt: updatedAtMs
            })
            .where(eq(sessionMessagesTable.id, existingRow.id))
            .run(),
        defaultHandlersFor('Message', String(existingRow.id))
      )
      replaceAgentSessionMessageFileRefsTx(db, existingRow.id, message.data)

      return {
        entity: this.rowToEntity({
          ...existingRow,
          role: message.role,
          status,
          data: message.data,
          searchableText: existingRow.searchableText,
          modelId,
          messageSnapshot,
          stats,
          runtimeResumeToken: runtimeResumeTokenToPersist,
          delivery,
          deliveryStatus,
          deliveryTurnRef,
          deliveryInReplyTo,
          deliverySenderSessionId,
          updatedAt: updatedAtMs
        }),
        dataChange: 'projection',
        activityTimestamp
      }
    }

    const insertData: InsertSessionMessageRow = {
      id: messageId,
      sessionId,
      role: message.role,
      status,
      data: message.data,
      modelId: message.modelId,
      messageSnapshot: message.messageSnapshot,
      stats: mergeMessageRuntimeStats(undefined, runtimeStats) ?? null,
      runtimeResumeToken,
      delivery: message.delivery,
      deliveryStatus: message.deliveryStatus,
      deliveryTurnRef: message.deliveryTurnRef,
      deliveryInReplyTo: message.deliveryInReplyTo,
      deliverySenderSessionId: message.deliverySenderSessionId,
      createdAt: timestampMs,
      updatedAt: timestampMs
    }

    const [saved] = db.insert(sessionMessagesTable).values(insertData).returning().all()
    replaceAgentSessionMessageFileRefsTx(db, saved.id, message.data)
    return {
      entity: this.rowToEntity(saved),
      dataChange: 'membership',
      activityTimestamp: isConversationActivityRole(message.role) ? timestampMs : null
    }
  }

  private saveMessageTx(
    db: DbOrTx,
    params: SaveAgentSessionMessageParams,
    timestampMs = Date.now()
  ): SavedAgentSessionMessage {
    const result = this.upsertMessage(db, params, timestampMs)
    agentSessionService.touchUpdatedAtTx(db, params.sessionId, timestampMs)
    if (result.activityTimestamp !== null) {
      agentSessionService.advanceLastActivityAtTx(db, params.sessionId, result.activityTimestamp)
    }
    return result
  }

  saveMessage(
    params: SaveAgentSessionMessageParams,
    options: SaveAgentSessionMessageOptions = {}
  ): AgentSessionMessageEntity {
    const { db, publishDataChange } = options
    const timestampMs = Date.now()
    if (db) return this.saveMessageTx(db, params, timestampMs).entity
    const result = application.get('DbService').withWriteTx((tx) => this.saveMessageTx(tx, params, timestampMs))
    if (result.entity.role === 'assistant') {
      aiUsageRecordService.refreshMessageProjection({ kind: 'agent-session', id: result.entity.id })
    }
    if (result.activityTimestamp !== null && !publishDataChange) {
      agentSessionService.notifyReadModelChange([params.sessionId], 'projection')
    }
    if (publishDataChange) {
      notifyDataApiDataChange([
        ...agentSessionReadModelEffects(result.activityTimestamp !== null ? [params.sessionId] : [], 'projection'),
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: result.dataChange,
          routeParams: { sessionId: params.sessionId },
          entityIds: [result.entity.id]
        }
      ])
    }
    return result.entity
  }

  saveMessages(
    params: CreateAgentSessionMessagesDto,
    expectedAgent?: string | { id: string; updatedAt: string; model: string; type: string }
  ): AgentSessionMessageEntity[] {
    const { entities: saved, activityTimestamp } = application
      .get('DbService')
      .withWriteTx((tx) => this.saveMessagesWithActivityTx(tx, params, expectedAgent))
    for (const entity of saved) {
      if (entity.role === 'assistant') {
        aiUsageRecordService.refreshMessageProjection({ kind: 'agent-session', id: entity.id })
      }
    }
    if (activityTimestamp !== null) {
      agentSessionService.notifyReadModelChange([params.sessionId], 'projection')
    }
    return saved
  }

  saveMessagesTx(
    tx: DbOrTx,
    params: CreateAgentSessionMessagesDto,
    expectedAgent?: string | { id: string; updatedAt: string; model: string; type: string }
  ): AgentSessionMessageEntity[] {
    return this.saveMessagesWithActivityTx(tx, params, expectedAgent).entities
  }

  private saveMessagesWithActivityTx(
    tx: DbOrTx,
    params: CreateAgentSessionMessagesDto,
    expectedAgent?: string | { id: string; updatedAt: string; model: string; type: string }
  ): { entities: AgentSessionMessageEntity[]; activityTimestamp: number | null } {
    const { sessionId, runtimeResumeToken, messages } = params
    this.assertExpectedAgentTx(tx, sessionId, expectedAgent)
    const timestampMs = Date.now()
    const saved = messages.map((message) =>
      this.upsertMessage(tx, { sessionId, runtimeResumeToken, message }, timestampMs)
    )
    const activityTimestamp = saved.reduce<number | null>(
      (latest, result) =>
        result.activityTimestamp === null
          ? latest
          : latest === null
            ? result.activityTimestamp
            : Math.max(latest, result.activityTimestamp),
      null
    )
    agentSessionService.touchUpdatedAtTx(tx, sessionId, timestampMs)
    if (activityTimestamp !== null) {
      agentSessionService.advanceLastActivityAtTx(tx, sessionId, activityTimestamp)
    }
    return { entities: saved.map((result) => result.entity), activityTimestamp }
  }

  /**
   * Persist one cross-session user message and its trusted sender/receiver envelope atomically.
   * The caller supplies only its runtime-bound identity; both addresses are re-read in this
   * transaction so a stale or forged tool context cannot impersonate another Session.
   */
  acceptSessionDelivery(input: {
    senderAgentId: string
    senderSessionId: string
    receiverSessionId: string
    content: string
    replyPolicy?: AgentSessionDeliveryReplyPolicy
  }): AgentSessionMessageEntity {
    const content = input.content.trim()
    if (!content) throw DataApiErrorFactory.validation({ content: ['must not be empty'] })

    const saved = application
      .get('DbService')
      .withWriteTx((tx) => this.acceptSessionDeliveryTx(tx, { ...input, content }))

    this.publishDeliveryMutation(
      [{ sessionId: saved.sessionId, messageId: saved.id, kind: 'membership' }],
      [saved.sessionId]
    )
    return saved
  }

  /** Atomically create a same-Agent Session and persist its first durable delivery. */
  createSessionWithDelivery(input: {
    senderAgentId: string
    senderSessionId: string
    sessionName: string
    workspace: AgentSessionWorkspaceSource
    content: string
  }): { session: AgentSessionEntity; message: AgentSessionMessageEntity } {
    const content = input.content.trim()
    if (!content) throw DataApiErrorFactory.validation({ content: ['must not be empty'] })

    const sessionId = uuidv4()
    const message = withSqliteErrors(
      () =>
        application.get('DbService').withWriteTx((tx) => {
          agentSessionService.createTx(tx, sessionId, {
            agentId: input.senderAgentId,
            name: input.sessionName,
            workspace: input.workspace
          })
          return this.acceptSessionDeliveryTx(tx, {
            senderAgentId: input.senderAgentId,
            senderSessionId: input.senderSessionId,
            receiverSessionId: sessionId,
            content,
            replyPolicy: 'completion'
          })
        }),
      {
        ...defaultHandlersFor('Session', sessionId),
        foreignKey: () => DataApiErrorFactory.notFound('Agent or Workspace')
      }
    )

    const session = agentSessionService.getById(sessionId)
    notifyDataApiDataChange([
      { endpoint: '/agent-sessions', kind: 'membership', entityIds: [sessionId] },
      ...(input.workspace.type === 'system'
        ? [{ endpoint: '/agent-workspaces' as const, kind: 'membership' as const, entityIds: [session.workspaceId] }]
        : []),
      { endpoint: '/agent-sessions/:sessionId/messages', kind: 'membership', entityIds: [message.id] }
    ])
    return { session, message }
  }

  private acceptSessionDeliveryTx(
    tx: DbOrTx,
    input: {
      senderAgentId: string
      senderSessionId: string
      receiverSessionId: string
      content: string
      replyPolicy?: AgentSessionDeliveryReplyPolicy
    }
  ): AgentSessionMessageEntity {
    const [sender] = tx
      .select({ agentId: sessionTable.agentId, agentName: agentTable.name, sessionName: sessionTable.name })
      .from(sessionTable)
      .leftJoin(agentTable, and(eq(sessionTable.agentId, agentTable.id), isNull(agentTable.deletedAt)))
      .where(eq(sessionTable.id, input.senderSessionId))
      .limit(1)
      .all()
    if (!sender || sender.agentId !== input.senderAgentId || sender.agentName === null) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.SENDER_FORBIDDEN,
        'The active runtime no longer owns the sender Session'
      )
    }

    const [receiverSession] = tx
      .select({ agentId: sessionTable.agentId, sessionName: sessionTable.name })
      .from(sessionTable)
      .where(eq(sessionTable.id, input.receiverSessionId))
      .limit(1)
      .all()
    if (!receiverSession) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_SESSION_NOT_FOUND,
        `Target Session not found: ${input.receiverSessionId}`
      )
    }
    if (!receiverSession.agentId) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_SESSION_ORPHANED,
        `Target Session has no Agent: ${input.receiverSessionId}`
      )
    }
    const [receiverAgent] = tx
      .select({ name: agentTable.name })
      .from(agentTable)
      .where(and(eq(agentTable.id, receiverSession.agentId), isNull(agentTable.deletedAt)))
      .limit(1)
      .all()
    if (!receiverAgent) {
      throw new AgentSessionDeliveryRoutingError(
        AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_AGENT_DELETED,
        `Target Agent is deleted: ${receiverSession.agentId}`
      )
    }

    const id = uuidv7()
    const statusAt = new Date().toISOString()
    const senderIdentity = {
      agentId: input.senderAgentId,
      sessionId: input.senderSessionId
    }
    const delivery: AgentSessionDeliveryEnvelope = {
      version: 1,
      sender: senderIdentity,
      receiver: {
        agentId: receiverSession.agentId,
        sessionId: input.receiverSessionId
      },
      senderSnapshot: {
        agentName: sender.agentName,
        sessionName: sender.sessionName
      },
      receiverSnapshot: {
        agentName: receiverAgent.name,
        sessionName: receiverSession.sessionName
      },
      replyPolicy: input.replyPolicy ?? 'none',
      sourceMessageId: null,
      outcome: null,
      error: null,
      statusAt
    }

    return this.saveMessageTx(tx, {
      sessionId: input.receiverSessionId,
      message: {
        id,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: input.content }] },
        delivery,
        deliveryStatus: 'accepted',
        deliveryInReplyTo: null,
        deliverySenderSessionId: senderIdentity.sessionId
      }
    }).entity
  }

  listRecoverableSessionDeliveries(sessionId?: string): AgentSessionMessageEntity[] {
    const filters = [inArray(sessionMessagesTable.deliveryStatus, [...AGENT_SESSION_DELIVERY_RECOVERABLE_STATUSES])]
    if (sessionId) filters.push(eq(sessionMessagesTable.sessionId, sessionId))
    return application
      .get('DbService')
      .getDb()
      .select()
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(sessionMessagesTable.createdAt, sessionMessagesTable.id)
      .all()
      .map((row) => this.rowToEntity(row))
  }

  listAcceptedSessionDeliveries(sessionId?: string): AgentSessionMessageEntity[] {
    const filters = [eq(sessionMessagesTable.deliveryStatus, 'accepted')]
    if (sessionId) filters.push(eq(sessionMessagesTable.sessionId, sessionId))
    return application
      .get('DbService')
      .getDb()
      .select()
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(sessionMessagesTable.createdAt, sessionMessagesTable.id)
      .all()
      .map((row) => this.rowToEntity(row))
  }

  findDeliveringSessionDeliveryByTurnRef(turnRef: string): AgentSessionMessageEntity | null {
    const row = application
      .get('DbService')
      .getDb()
      .select()
      .from(sessionMessagesTable)
      .where(
        and(eq(sessionMessagesTable.deliveryStatus, 'delivering'), eq(sessionMessagesTable.deliveryTurnRef, turnRef))
      )
      .limit(1)
      .get()
    return row ? this.rowToEntity(row) : null
  }

  publishDeliveryChanges(messages: readonly AgentSessionMessageEntity[]): void {
    this.publishDeliveryMutation(
      messages.map((message) => ({
        sessionId: message.sessionId,
        messageId: message.id,
        kind: 'membership' as const
      })),
      messages.map((message) => message.sessionId)
    )
  }

  /** Publish a delivery claim's existing request projection and new assistant placeholder. */
  publishDispatchChanges(sessionId: string, messages: readonly AgentSessionMessageEntity[]): void {
    if (messages.length === 0) return
    this.publishDeliveryMutation(
      messages.map((message, index) => ({
        sessionId,
        messageId: message.id,
        kind: index === 0 ? ('projection' as const) : ('membership' as const)
      })),
      [sessionId]
    )
  }

  listSessionDeliveries(
    input:
      | string
      | {
          sessionId: string
          direction?: 'incoming' | 'outgoing'
          requestId?: string
          status?: AgentSessionDeliveryStatus
          limit?: number
        },
    legacyLimit?: number
  ): AgentSessionMessageEntity[] {
    const query = typeof input === 'string' ? { sessionId: input, limit: legacyLimit } : input
    const filters = [isNotNull(sessionMessagesTable.delivery)]
    if (query.requestId) {
      filters.push(
        or(eq(sessionMessagesTable.id, query.requestId), eq(sessionMessagesTable.deliveryInReplyTo, query.requestId))!
      )
    }
    if (query.status) filters.push(eq(sessionMessagesTable.deliveryStatus, query.status))
    if (query.requestId) {
      filters.push(
        or(
          eq(sessionMessagesTable.sessionId, query.sessionId),
          eq(sessionMessagesTable.deliverySenderSessionId, query.sessionId)
        )!
      )
    } else if (query.direction === 'outgoing') {
      filters.push(eq(sessionMessagesTable.deliverySenderSessionId, query.sessionId))
    } else {
      filters.push(eq(sessionMessagesTable.sessionId, query.sessionId))
    }

    return application
      .get('DbService')
      .getDb()
      .select()
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(desc(sessionMessagesTable.createdAt), desc(sessionMessagesTable.id))
      .limit(Math.min(Math.max(query.limit ?? 20, 1), 100))
      .all()
      .map((row) => this.rowToEntity(row))
  }

  transitionSessionDelivery(
    sessionId: string,
    messageId: string,
    status: AgentSessionDeliveryStatus,
    options: {
      expected?: AgentSessionDeliveryStatus[]
      turnRef?: string | null
      outcome?: AgentSessionDeliveryOutcome | null
      error?: AgentSessionDeliveryError | null
    } = {}
  ): AgentSessionMessageEntity | null {
    const updated = application.get('DbService').withWriteTx((tx) => {
      const existing = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existing?.delivery || !existing.deliveryStatus) return null
      if (options.expected && !options.expected.includes(existing.deliveryStatus)) return null
      if (existing.deliveryStatus === 'consumed' || existing.deliveryStatus === 'failed') {
        return this.rowToEntity(existing)
      }

      const delivery: AgentSessionDeliveryEnvelope = {
        ...existing.delivery,
        ...(options.outcome !== undefined ? { outcome: options.outcome } : {}),
        ...(options.error !== undefined ? { error: options.error } : {}),
        statusAt: new Date().toISOString()
      }
      const [row] = tx
        .update(sessionMessagesTable)
        .set({
          delivery,
          deliveryStatus: status,
          deliveryTurnRef: status === 'delivering' ? (options.turnRef ?? existing.deliveryTurnRef) : null
        })
        .where(
          and(
            eq(sessionMessagesTable.id, messageId),
            eq(sessionMessagesTable.sessionId, sessionId),
            ...(options.expected ? [inArray(sessionMessagesTable.deliveryStatus, options.expected)] : [])
          )
        )
        .returning()
        .all()
      return row ? this.rowToEntity(row) : null
    })
    if (updated) this.publishDeliveryChange(sessionId, messageId, 'projection')
    return updated
  }

  claimSessionDeliveryTx(
    tx: DbOrTx,
    sessionId: string,
    messageId: string,
    turnRef: string
  ): AgentSessionMessageEntity | null {
    const existing = this.findExistingMessageRow(tx, sessionId, messageId)
    if (!existing?.delivery || existing.deliveryStatus !== 'accepted') return null
    const delivery = { ...existing.delivery, statusAt: new Date().toISOString() }
    const row = tx
      .update(sessionMessagesTable)
      .set({ delivery, deliveryStatus: 'delivering', deliveryTurnRef: turnRef })
      .where(
        and(
          eq(sessionMessagesTable.id, messageId),
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.deliveryStatus, 'accepted')
        )
      )
      .returning()
      .get()
    return row ? this.rowToEntity(row) : null
  }

  updateSessionDeliveryStatus(
    sessionId: string,
    messageId: string,
    status: AgentSessionDeliveryStatus,
    error: AgentSessionDeliveryError | null = null
  ): AgentSessionMessageEntity | null {
    return this.transitionSessionDelivery(sessionId, messageId, status, {
      ...(status === 'failed' ? { error, outcome: 'failed' as const } : {})
    })
  }

  finalizeSessionDelivery(input: {
    requestSessionId: string
    requestMessageId: string
    assistantMessageId: string
    outcome: AgentSessionDeliveryOutcome
  }): AgentSessionMessageEntity | null {
    const finalized = application.get('DbService').withWriteTx((tx) => {
      const request = this.findExistingMessageRow(tx, input.requestSessionId, input.requestMessageId)
      if (!request?.delivery || !request.deliveryStatus) return { requestId: null, result: null }

      if (request.deliveryStatus !== 'delivering' || request.deliveryTurnRef !== input.assistantMessageId) {
        return { requestId: null, result: null }
      }

      const existingResult = tx
        .select()
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
        .limit(1)
        .get()
      if (existingResult) {
        tx.update(sessionMessagesTable)
          .set({
            deliveryStatus: 'consumed',
            deliveryTurnRef: null,
            delivery: { ...request.delivery, outcome: input.outcome, statusAt: new Date().toISOString() }
          })
          .where(eq(sessionMessagesTable.id, request.id))
          .run()
        return {
          requestId: request.id,
          result: existingResult.deliveryStatus === 'accepted' ? this.rowToEntity(existingResult) : null
        }
      }

      const assistant = this.findExistingMessageRow(tx, input.requestSessionId, input.assistantMessageId)
      if (!assistant || assistant.role !== 'assistant' || assistant.status === 'pending') {
        return { requestId: null, result: null }
      }

      let result: AgentSessionMessageEntity | null = null
      if (request.delivery.replyPolicy === 'completion') {
        const callerExists = tx
          .select({ id: sessionTable.id })
          .from(sessionTable)
          .where(eq(sessionTable.id, request.delivery.sender.sessionId))
          .limit(1)
          .all()[0]
        if (!callerExists) {
          tx.update(sessionMessagesTable)
            .set({
              deliveryStatus: 'failed',
              deliveryTurnRef: null,
              delivery: {
                ...request.delivery,
                outcome: 'failed',
                error: { code: 'CALLER_SESSION_DELETED', message: 'Caller Session was deleted' },
                statusAt: new Date().toISOString()
              }
            })
            .where(eq(sessionMessagesTable.id, request.id))
            .run()
          return { requestId: request.id, result: null }
        }
        const resultEnvelope: AgentSessionDeliveryEnvelope = {
          version: 1,
          sender: request.delivery.receiver,
          receiver: request.delivery.sender,
          senderSnapshot: request.delivery.receiverSnapshot,
          receiverSnapshot: request.delivery.senderSnapshot,
          replyPolicy: 'none',
          sourceMessageId: assistant.id,
          outcome: input.outcome,
          error: null,
          statusAt: new Date().toISOString()
        }
        result = this.saveMessageTx(tx, {
          sessionId: request.delivery.sender.sessionId,
          message: {
            id: uuidv7(),
            role: 'user',
            status: 'success',
            data: terminalResultData(assistant, input.outcome),
            delivery: resultEnvelope,
            deliveryStatus: 'accepted',
            deliveryInReplyTo: request.id,
            deliverySenderSessionId: request.delivery.receiver.sessionId
          }
        }).entity
      }

      tx.update(sessionMessagesTable)
        .set({
          deliveryStatus: 'consumed',
          deliveryTurnRef: null,
          delivery: { ...request.delivery, outcome: input.outcome, statusAt: new Date().toISOString() }
        })
        .where(eq(sessionMessagesTable.id, request.id))
        .run()
      return { requestId: request.id, result }
    })

    this.publishDeliveryMutation(
      [
        ...(finalized.requestId
          ? [{ sessionId: input.requestSessionId, messageId: finalized.requestId, kind: 'projection' as const }]
          : []),
        ...(finalized.result
          ? [{ sessionId: finalized.result.sessionId, messageId: finalized.result.id, kind: 'membership' as const }]
          : [])
      ],
      finalized.result ? [finalized.result.sessionId] : []
    )
    return finalized.result
  }

  failSessionDelivery(
    message: AgentSessionMessageEntity,
    error: AgentSessionDeliveryError
  ): AgentSessionMessageEntity | null {
    const failed = application.get('DbService').withWriteTx((tx) => {
      const request = this.findExistingMessageRow(tx, message.sessionId, message.id)
      if (!request?.delivery || !request.deliveryStatus) return { requestId: null, result: null }
      const now = new Date().toISOString()
      let result: AgentSessionMessageEntity | null = null
      if (request.delivery.replyPolicy === 'completion') {
        const callerExists = tx
          .select({ id: sessionTable.id })
          .from(sessionTable)
          .where(eq(sessionTable.id, request.delivery.sender.sessionId))
          .limit(1)
          .all()[0]
        const existingResult = tx
          .select()
          .from(sessionMessagesTable)
          .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
          .limit(1)
          .get()
        result = !callerExists
          ? null
          : existingResult
            ? existingResult.deliveryStatus === 'accepted'
              ? this.rowToEntity(existingResult)
              : null
            : this.saveMessageTx(tx, {
                sessionId: request.delivery.sender.sessionId,
                message: {
                  id: uuidv7(),
                  role: 'user',
                  status: 'success',
                  data: terminalResultData(null, 'failed', error),
                  delivery: {
                    version: 1,
                    sender: request.delivery.receiver,
                    receiver: request.delivery.sender,
                    senderSnapshot: request.delivery.receiverSnapshot,
                    receiverSnapshot: request.delivery.senderSnapshot,
                    replyPolicy: 'none',
                    sourceMessageId: null,
                    outcome: 'failed',
                    error,
                    statusAt: now
                  },
                  deliveryStatus: 'accepted',
                  deliveryInReplyTo: request.id,
                  deliverySenderSessionId: request.delivery.receiver.sessionId
                }
              }).entity
      }
      tx.update(sessionMessagesTable)
        .set({
          deliveryStatus: 'failed',
          deliveryTurnRef: null,
          delivery: { ...request.delivery, outcome: 'failed', error, statusAt: now }
        })
        .where(eq(sessionMessagesTable.id, request.id))
        .run()
      return { requestId: request.id, result }
    })
    this.publishDeliveryMutation(
      [
        ...(failed.requestId
          ? [{ sessionId: message.sessionId, messageId: failed.requestId, kind: 'projection' as const }]
          : []),
        ...(failed.result
          ? [{ sessionId: failed.result.sessionId, messageId: failed.result.id, kind: 'membership' as const }]
          : [])
      ],
      failed.result ? [failed.result.sessionId] : []
    )
    return failed.result
  }

  prepareSessionDeletionTx(tx: DbOrTx, sessionIds: readonly string[]): AgentSessionMessageEntity[] {
    const deleting = [...new Set(sessionIds)]
    if (deleting.length === 0) return []
    const requests = tx
      .select()
      .from(sessionMessagesTable)
      .where(
        and(
          inArray(sessionMessagesTable.sessionId, deleting),
          inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
        )
      )
      .all()
    const results: AgentSessionMessageEntity[] = []
    const now = new Date().toISOString()
    for (const request of requests) {
      if (
        !request.delivery ||
        request.delivery.replyPolicy !== 'completion' ||
        deleting.includes(request.delivery.sender.sessionId)
      )
        continue
      const existingResult = tx
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
        .limit(1)
        .all()[0]
      if (existingResult) continue
      const callerExists = tx
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(eq(sessionTable.id, request.delivery.sender.sessionId))
        .limit(1)
        .all()[0]
      if (!callerExists) continue
      results.push(
        this.saveMessageTx(tx, {
          sessionId: request.delivery.sender.sessionId,
          message: {
            id: uuidv7(),
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'Target Session was deleted before completing the request.' }] },
            delivery: {
              version: 1,
              sender: request.delivery.receiver,
              receiver: request.delivery.sender,
              senderSnapshot: request.delivery.receiverSnapshot,
              receiverSnapshot: request.delivery.senderSnapshot,
              replyPolicy: 'none',
              sourceMessageId: null,
              outcome: 'failed',
              error: { code: 'TARGET_SESSION_DELETED', message: 'Target Session was deleted' },
              statusAt: now
            },
            deliveryStatus: 'accepted',
            deliveryInReplyTo: request.id,
            deliverySenderSessionId: request.delivery.receiver.sessionId
          }
        }).entity
      )
    }
    return results
  }

  /** Fail active requests before their target Agent is removed while the Session rows are retained. */
  prepareRetainedSessionAgentDeletionTx(tx: DbOrTx, sessionIds: readonly string[]): AgentSessionMessageEntity[] {
    const affected = new Set(sessionIds)
    if (affected.size === 0) return []
    const requests = tx
      .select()
      .from(sessionMessagesTable)
      .where(
        and(
          inArray(sessionMessagesTable.sessionId, [...affected]),
          inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
        )
      )
      .all()
    const changes: AgentSessionMessageEntity[] = []
    const now = new Date().toISOString()
    const error = { code: AGENT_SESSION_DELIVERY_ERROR_CODES.TARGET_AGENT_DELETED, message: 'Target Agent was deleted' }
    for (const request of requests) {
      if (!request.delivery) continue
      const failedRequest = tx
        .update(sessionMessagesTable)
        .set({
          deliveryStatus: 'failed',
          deliveryTurnRef: null,
          delivery: { ...request.delivery, outcome: 'interrupted', error, statusAt: now }
        })
        .where(
          and(
            eq(sessionMessagesTable.id, request.id),
            inArray(sessionMessagesTable.deliveryStatus, ['accepted', 'delivering'])
          )
        )
        .returning()
        .get()
      if (failedRequest) changes.push(this.rowToEntity(failedRequest))

      if (request.delivery.replyPolicy !== 'completion' || affected.has(request.delivery.sender.sessionId)) continue
      const existingResult = tx
        .select({ id: sessionMessagesTable.id })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.deliveryInReplyTo, request.id))
        .limit(1)
        .get()
      if (existingResult) continue
      const callerExists = tx
        .select({ id: sessionTable.id })
        .from(sessionTable)
        .where(eq(sessionTable.id, request.delivery.sender.sessionId))
        .limit(1)
        .get()
      if (!callerExists) continue
      changes.push(
        this.saveMessageTx(tx, {
          sessionId: request.delivery.sender.sessionId,
          message: {
            id: uuidv7(),
            role: 'user',
            status: 'success',
            data: { parts: [{ type: 'text', text: 'Target Agent was deleted before completing the request.' }] },
            delivery: {
              version: 1,
              sender: request.delivery.receiver,
              receiver: request.delivery.sender,
              senderSnapshot: request.delivery.receiverSnapshot,
              receiverSnapshot: request.delivery.senderSnapshot,
              replyPolicy: 'none',
              sourceMessageId: null,
              outcome: 'interrupted',
              error,
              statusAt: now
            },
            deliveryStatus: 'accepted',
            deliveryInReplyTo: request.id,
            deliverySenderSessionId: request.delivery.receiver.sessionId
          }
        }).entity
      )
    }
    return changes
  }

  private publishDeliveryChange(sessionId: string, messageId: string, kind: 'membership' | 'projection'): void {
    this.publishDeliveryMutation([{ sessionId, messageId, kind }])
  }

  private publishDeliveryMutation(
    changes: readonly {
      sessionId: string
      messageId: string
      kind: 'membership' | 'projection'
    }[],
    activitySessionIds: readonly string[] = []
  ): void {
    if (changes.length === 0 && activitySessionIds.length === 0) return
    notifyDataApiDataChange([
      ...agentSessionReadModelEffects(activitySessionIds, 'projection'),
      ...changes.map(({ sessionId, messageId, kind }) => ({
        endpoint: '/agent-sessions/:sessionId/messages' as const,
        kind,
        routeParams: { sessionId },
        entityIds: [messageId]
      }))
    ])
  }

  /** Reject ownership changes before any message row is written in this transaction. */
  private assertExpectedAgentTx(
    db: DbOrTx,
    sessionId: string,
    expectedAgent: string | { id: string; updatedAt: string; model: string; type: string } | undefined
  ): void {
    if (!expectedAgent) return
    const expectedAgentId = typeof expectedAgent === 'string' ? expectedAgent : expectedAgent.id
    const [session] = db
      .select({
        agentId: sessionTable.agentId,
        agentUpdatedAt: agentTable.updatedAt,
        agentModel: agentTable.model,
        agentType: agentTable.type
      })
      .from(sessionTable)
      .leftJoin(agentTable, eq(sessionTable.agentId, agentTable.id))
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
      .all()
    if (!session || session.agentId !== expectedAgentId) {
      throw DataApiErrorFactory.notFound('Session', sessionId)
    }
    if (
      typeof expectedAgent !== 'string' &&
      (!session.agentUpdatedAt ||
        new Date(session.agentUpdatedAt).toISOString() !== expectedAgent.updatedAt ||
        session.agentModel !== expectedAgent.model ||
        (session.agentType === 'cherry-claw' ? 'claude-code' : session.agentType) !== expectedAgent.type)
    ) {
      throw DataApiErrorFactory.concurrentModification('Agent', expectedAgent.id)
    }
  }

  replaceMessageParts(
    sessionId: string,
    messageId: string,
    parts: AgentSessionMessageEntity['data']['parts']
  ): AgentSessionMessageEntity {
    const saved = application.get('DbService').withWriteTx((tx) => {
      const existingRow = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existingRow) throw DataApiErrorFactory.notFound('Message', messageId)

      const updatedAt = Date.now()
      const data = { ...existingRow.data, parts }
      const [updated] = tx
        .update(sessionMessagesTable)
        .set({ data, updatedAt })
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .returning()
        .all()
      replaceAgentSessionMessageFileRefsTx(tx, messageId, data)
      agentSessionService.touchUpdatedAtTx(tx, sessionId, updatedAt)
      return this.rowToEntity(updated)
    })

    notifyDataApiDataChange([
      {
        endpoint: '/agent-sessions/:sessionId/messages',
        kind: 'projection',
        routeParams: { sessionId },
        entityIds: [messageId]
      }
    ])
    return saved
  }

  /**
   * Atomically settle one persisted agent-session approval card. The SDK callback is resolved only
   * after this returns true, so a displayed question cannot resume its agent while remaining stuck
   * as `approval-requested` in history.
   */
  applyToolApprovalDecision(sessionId: string, messageId: string, decision: ApprovalDecision): boolean {
    const applied = application.get('DbService').withWriteTx((tx) => {
      const existingRow = this.findExistingMessageRow(tx, sessionId, messageId)
      if (!existingRow) return false

      const existing = this.rowToEntity(existingRow)
      const parts = existing.data.parts ?? []
      const hasPendingApproval = parts.some(
        (part) =>
          isToolUIPart(part) &&
          part.state === 'approval-requested' &&
          (part as { approval?: { id?: string } }).approval?.id === decision.approvalId
      )
      if (!hasPendingApproval) return false

      const updatedAt = Date.now()
      const nextParts = applyApprovalDecisions(parts, [decision])
      tx.update(sessionMessagesTable)
        .set({ data: { ...existing.data, parts: nextParts }, updatedAt })
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .run()
      agentSessionService.touchUpdatedAtTx(tx, sessionId, updatedAt)
      agentSessionService.advanceLastActivityAtTx(tx, sessionId, updatedAt)
      return true
    })

    if (applied) {
      agentSessionService.notifyReadModelChange([sessionId], 'projection')
      notifyDataApiDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          routeParams: { sessionId },
          entityIds: [messageId]
        }
      ])
    }
    return applied
  }
}

export const agentSessionMessageService = new AgentSessionMessageService()
registerDataService('AgentSessionMessageService', agentSessionMessageService)
