import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
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
import { agentSessionService } from '@data/services/AgentSessionService'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { buildSearchSnippet } from '@main/utils/searchSnippet'
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
import type { SessionMessageContentSearchItem } from '@shared/data/api/schemas/search'
import type { CursorPaginationResponse } from '@shared/data/api/types'
import {
  AGENT_SESSION_MESSAGE_SEARCH_ROLES,
  coerceSearchRole,
  type MessageRuntimeStatsInput
} from '@shared/data/types/message'
import { readCherryMeta } from '@shared/data/types/uiParts'
import { isToolUIPart } from 'ai'
import { and, desc, eq, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm'
import { v7 as uuidv7, validate as isUuid } from 'uuid'

import { aiUsageRecordService, mergeMessageRuntimeStats } from './AiUsageRecordService'
import { type SearchFetchContext, searchWithCursor } from './utils/ftsSearch'
import { asNumericKey, decodeListCursor, encodeCursor, keysetOrdering } from './utils/keysetCursor'

const logger = loggerService.withContext('AgentSessionMessageService')
const SQLITE_INARRAY_CHUNK = 500
const MESSAGE_CURSOR_CONFIG = {
  fieldMessage: 'must be a valid message cursor',
  errorMessage: 'Invalid message cursor'
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

type ListSessionMessagesOptions = {
  cursor?: string
  limit?: number
  messageId?: string
}

type SaveAgentSessionMessageParams = {
  sessionId: string
  runtimeResumeToken?: string
  runtimeStats?: MessageRuntimeStatsInput
  message: CreateAgentSessionMessageDto
}

type SaveAgentSessionMessageOptions =
  | { db: DbOrTx; publishDataChange?: never }
  | { db?: undefined; publishDataChange?: boolean }

type SavedAgentSessionMessage = {
  entity: AgentSessionMessageEntity
  dataChange: 'membership' | 'projection'
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
        item: {
          messageId: row.rowId,
          sessionId: row.sessionId,
          sessionName: row.sessionName,
          agentId: row.agentId ?? undefined,
          agentName: row.agentName ?? undefined,
          role: coerceSearchRole(row.role, AGENT_SESSION_MESSAGE_SEARCH_ROLES),
          snippet,
          createdAt: timestampToISO(Number(row.createdAt))
        },
        sort: {
          createdAt: Number(row.createdAt),
          id: row.rowId
        }
      })
    })
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
      const [updated] = tx
        .update(sessionMessagesTable)
        .set({ data: dto.data, updatedAt })
        .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
        .returning()
        .all()
      replaceAgentSessionMessageFileRefsTx(tx, messageId, dto.data)
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

  /**
   * Ids of assistant rows still in `pending` — used by the agent-session boot reconcile to
   * resolve turns a prior main-process crash left stuck (the runtime never reached its terminal
   * write, and the in-memory entry map is empty after a restart, so nothing else settles them).
   */
  findPendingAssistantMessageIds(): string[] {
    const database = application.get('DbService').getDb()
    const rows = database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.role, 'assistant'), eq(sessionMessagesTable.status, 'pending')))
      .all()
    return rows.map((row) => row.id)
  }

  /** Bulk-resolve the given rows to `error` — the boot reconcile of crash-orphaned `pending` rows. */
  markMessagesError(ids: string[]): void {
    if (ids.length === 0) return
    const db = application.get('DbService').getDb()
    db.update(sessionMessagesTable).set({ status: 'error' }).where(inArray(sessionMessagesTable.id, ids)).run()
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
          updatedAt: updatedAtMs
        }),
        dataChange: 'projection'
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
      createdAt: timestampMs,
      updatedAt: timestampMs
    }

    const [saved] = db.insert(sessionMessagesTable).values(insertData).returning().all()
    replaceAgentSessionMessageFileRefsTx(db, saved.id, message.data)
    return { entity: this.rowToEntity(saved), dataChange: 'membership' }
  }

  private saveMessageTx(
    db: DbOrTx,
    params: SaveAgentSessionMessageParams,
    timestampMs = Date.now()
  ): SavedAgentSessionMessage {
    const result = this.upsertMessage(db, params, timestampMs)
    agentSessionService.touchUpdatedAtTx(db, params.sessionId, timestampMs)
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
    if (publishDataChange) {
      notifyDataApiDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: result.dataChange,
          entityIds: [result.entity.id]
        }
      ])
    }
    return result.entity
  }

  saveMessages(params: CreateAgentSessionMessagesDto, expectedAgentId?: string): AgentSessionMessageEntity[] {
    const { sessionId, runtimeResumeToken, messages } = params

    const saved = application.get('DbService').withWriteTx((tx) => {
      this.assertExpectedAgentTx(tx, sessionId, expectedAgentId)
      const timestampMs = Date.now()
      const result: AgentSessionMessageEntity[] = []
      for (const message of messages) {
        result.push(this.upsertMessage(tx, { sessionId, runtimeResumeToken, message }, timestampMs).entity)
      }
      agentSessionService.touchUpdatedAtTx(tx, sessionId, timestampMs)
      return result
    })
    for (const entity of saved) {
      if (entity.role === 'assistant') {
        aiUsageRecordService.refreshMessageProjection({ kind: 'agent-session', id: entity.id })
      }
    }
    return saved
  }

  /** Reject ownership changes before any message row is written in this transaction. */
  private assertExpectedAgentTx(db: DbOrTx, sessionId: string, expectedAgentId: string | undefined): void {
    if (!expectedAgentId) return
    const [session] = db
      .select({ agentId: sessionTable.agentId })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
      .all()
    if (!session || session.agentId !== expectedAgentId) {
      throw DataApiErrorFactory.notFound('Session', sessionId)
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
      return true
    })

    if (applied) {
      notifyDataApiDataChange([
        {
          endpoint: '/agent-sessions/:sessionId/messages',
          kind: 'projection',
          entityIds: [messageId]
        }
      ])
    }
    return applied
  }
}

export const agentSessionMessageService = new AgentSessionMessageService()
