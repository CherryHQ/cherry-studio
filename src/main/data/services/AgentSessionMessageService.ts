import { application } from '@application'
import { agentSessionTable as sessionTable } from '@data/db/schemas/agentSession'
import {
  type AgentSessionMessageRow as SessionMessageRow,
  agentSessionMessageTable as sessionMessagesTable,
  type InsertAgentSessionMessageRow as InsertSessionMessageRow
} from '@data/db/schemas/agentSessionMessage'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type {
  AgentSessionMessageEntity,
  CreateAgentSessionMessageDto,
  CreateAgentSessionMessagesDto
} from '@shared/data/api/schemas/agentSessions'
import {
  AGENT_SESSION_MESSAGES_DEFAULT_LIMIT,
  AGENT_SESSION_MESSAGES_MAX_LIMIT
} from '@shared/data/api/schemas/agentSessions'
import type { SessionMessageContentSearchItem } from '@shared/data/api/schemas/search'
import { AGENT_SESSION_MESSAGE_SEARCH_ROLES, coerceSearchRole } from '@shared/data/types/message'
import { buildSearchSnippet } from '@shared/utils/searchSnippet'
import { and, desc, eq, inArray, isNotNull, lt, or, sql } from 'drizzle-orm'
import { v7 as uuidv7, validate as isUuid } from 'uuid'

import { decodeSearchCursor, encodeSearchCursor, type SearchFetchContext, searchWithCursor } from './utils/ftsSearch'

const logger = loggerService.withContext('AgentSessionMessageService')
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

// Cursor wire format: `<createdAt-ms>:<id>` — opaque server-issued tokens.
function decodeMessageCursor(raw: string): { createdAt: number; id: string } | null {
  try {
    return decodeSearchCursor(raw, MESSAGE_CURSOR_CONFIG)
  } catch (error) {
    logger.warn('Ignoring malformed session message list cursor', { cursor: raw, error })
    return null
  }
}

export class AgentSessionMessageService {
  async search(query: SessionMessageContentSearchInput) {
    const db = application.get('DbService').getDb()
    const messageSessionCondition = query.sessionId ? sql`sm.session_id = ${query.sessionId}` : sql`1 = 1`

    return await searchWithCursor<SessionMessageSearchRow, SessionMessageContentSearchItem>({
      q: query.q,
      limit: query.limit,
      cursor: query.cursor,
      createdAtFrom: query.createdAtFrom,
      cursorConfig: MESSAGE_CURSOR_CONFIG,
      fetchRows: async ({ ftsConditions, cursor, createdAtFromMs, offset, chunkSize }: SearchFetchContext) => {
        const createdAtCondition = createdAtFromMs !== undefined ? sql`sm.created_at >= ${createdAtFromMs}` : sql`1 = 1`

        return await db.all<SessionMessageSearchRow>(sql`
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
          JOIN agent_session_message_fts fts ON sm.rowid = fts.rowid
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
  async listSessionMessages(
    sessionId: string,
    options: { cursor?: string; limit?: number } = {}
  ): Promise<CursorPaginationResponse<AgentSessionMessageEntity>> {
    const database = application.get('DbService').getDb()

    const [session] = await database
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
    if (!session) throw DataApiErrorFactory.notFound('Session', sessionId)

    const limit = Math.min(options.limit ?? AGENT_SESSION_MESSAGES_DEFAULT_LIMIT, AGENT_SESSION_MESSAGES_MAX_LIMIT)
    const cursor = options.cursor ? decodeMessageCursor(options.cursor) : null

    const filters = [eq(sessionMessagesTable.sessionId, sessionId)]
    if (cursor) {
      // Walk older: (createdAt, id) < (cursor.createdAt, cursor.id)
      filters.push(
        or(
          lt(sessionMessagesTable.createdAt, cursor.createdAt),
          and(eq(sessionMessagesTable.createdAt, cursor.createdAt), lt(sessionMessagesTable.id, cursor.id))
        )!
      )
    }

    const rows = await database
      .select()
      .from(sessionMessagesTable)
      .where(and(...filters))
      .orderBy(desc(sessionMessagesTable.createdAt), desc(sessionMessagesTable.id))
      .limit(limit + 1)

    const hasNext = rows.length > limit
    const pageRows = hasNext ? rows.slice(0, limit) : rows
    const items = pageRows.map((row) => this.rowToEntity(row))
    const tail = pageRows[pageRows.length - 1]
    const nextCursor = hasNext && tail ? encodeSearchCursor(tail.createdAt, tail.id) : undefined

    return { items, nextCursor }
  }

  async deleteSessionMessage(sessionId: string, messageId: string): Promise<void> {
    if (!messageId) {
      throw DataApiErrorFactory.validation({ messageId: ['must not be empty'] })
    }
    const database = application.get('DbService').getDb()

    const [session] = await database
      .select({ id: sessionTable.id })
      .from(sessionTable)
      .where(eq(sessionTable.id, sessionId))
      .limit(1)
    if (!session) throw DataApiErrorFactory.notFound('Session', sessionId)

    const result = await withSqliteErrors(
      () => application.get('DbService').withWriteTx((tx) => this.deleteSessionMessageTx(tx, sessionId, messageId)),
      defaultHandlersFor('Message', messageId)
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Message', messageId)
    }
  }

  async deleteSessionMessageTx(tx: DbOrTx, sessionId: string, messageId: string): Promise<{ rowsAffected: number }> {
    return tx
      .delete(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId)))
  }

  /**
   * Ids of assistant rows still in `pending` — used by the agent-session boot reconcile to
   * resolve turns a prior main-process crash left stuck (the runtime never reached its terminal
   * write, and the in-memory entry map is empty after a restart, so nothing else settles them).
   */
  async findPendingAssistantMessageIds(): Promise<string[]> {
    const database = application.get('DbService').getDb()
    const rows = await database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.role, 'assistant'), eq(sessionMessagesTable.status, 'pending')))
    return rows.map((row) => row.id)
  }

  /** Bulk-resolve the given rows to `error` — the boot reconcile of crash-orphaned `pending` rows. */
  async markMessagesError(ids: string[]): Promise<void> {
    if (ids.length === 0) return
    await application.get('DbService').withWriteTx(async (tx) => {
      await tx.update(sessionMessagesTable).set({ status: 'error' }).where(inArray(sessionMessagesTable.id, ids))
    })
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
      modelSnapshot: row.modelSnapshot,
      traceId: row.traceId,
      stats: row.stats,
      runtimeResumeToken: row.runtimeResumeToken,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  async getLastRuntimeResumeToken(sessionId: string): Promise<string | null> {
    try {
      const database = application.get('DbService').getDb()
      const result = await database
        .select({ runtimeResumeToken: sessionMessagesTable.runtimeResumeToken })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), isNotNull(sessionMessagesTable.runtimeResumeToken)))
        .orderBy(desc(sessionMessagesTable.createdAt))
        .limit(1)

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

  private async findExistingMessageRow(
    db: DbOrTx,
    sessionId: string,
    messageId: string
  ): Promise<SessionMessageRow | null> {
    const rows = await db
      .select()
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.sessionId, sessionId), eq(sessionMessagesTable.id, messageId)))
      .limit(1)

    return rows[0] ?? null
  }

  private async upsertMessage(
    db: DbOrTx,
    params: { sessionId: string; runtimeResumeToken?: string; message: CreateAgentSessionMessageDto },
    timestampMs = Date.now()
  ): Promise<AgentSessionMessageEntity> {
    const { sessionId, runtimeResumeToken = null, message } = params
    const messageId = message.id ?? uuidv7()
    const status = message.status ?? 'success'

    if (!message.role) {
      throw DataApiErrorFactory.validation({ role: ['is required'] }, 'Message payload missing role')
    }

    if (!isUuid(messageId)) {
      throw DataApiErrorFactory.validation({ id: ['must be a UUID'] }, 'Agent session message id must be a UUID')
    }

    const existingRow = await this.findExistingMessageRow(db, sessionId, messageId)

    if (existingRow) {
      const runtimeResumeTokenToPersist = runtimeResumeToken ?? existingRow.runtimeResumeToken ?? null
      const updatedAtMs = timestampMs
      const modelId = message.modelId === undefined ? existingRow.modelId : message.modelId
      const modelSnapshot = message.modelSnapshot === undefined ? existingRow.modelSnapshot : message.modelSnapshot
      const traceId = message.traceId === undefined ? existingRow.traceId : message.traceId
      const stats = message.stats === undefined ? existingRow.stats : message.stats

      await withSqliteErrors(
        () =>
          db
            .update(sessionMessagesTable)
            .set({
              role: message.role,
              status,
              data: message.data,
              modelId,
              modelSnapshot,
              traceId,
              stats,
              runtimeResumeToken: runtimeResumeTokenToPersist,
              updatedAt: updatedAtMs
            })
            .where(eq(sessionMessagesTable.id, existingRow.id)),
        defaultHandlersFor('Message', String(existingRow.id))
      )

      return this.rowToEntity({
        ...existingRow,
        role: message.role,
        status,
        data: message.data,
        searchableText: existingRow.searchableText,
        modelId,
        modelSnapshot,
        traceId,
        stats,
        runtimeResumeToken: runtimeResumeTokenToPersist,
        updatedAt: updatedAtMs
      })
    }

    const insertData: InsertSessionMessageRow = {
      id: messageId,
      sessionId,
      role: message.role,
      status,
      data: message.data,
      modelId: message.modelId,
      modelSnapshot: message.modelSnapshot,
      traceId: message.traceId,
      stats: message.stats,
      runtimeResumeToken,
      createdAt: timestampMs,
      updatedAt: timestampMs
    }

    const [saved] = await db.insert(sessionMessagesTable).values(insertData).returning()
    return this.rowToEntity(saved)
  }

  private async touchSessionUpdatedAt(db: DbOrTx, sessionId: string, timestampMs: number): Promise<void> {
    await db.update(sessionTable).set({ updatedAt: timestampMs }).where(eq(sessionTable.id, sessionId))
  }

  private async saveMessageTx(
    db: DbOrTx,
    params: { sessionId: string; runtimeResumeToken?: string; message: CreateAgentSessionMessageDto },
    timestampMs = Date.now()
  ): Promise<AgentSessionMessageEntity> {
    const saved = await this.upsertMessage(db, params, timestampMs)
    await this.touchSessionUpdatedAt(db, params.sessionId, timestampMs)
    return saved
  }

  async saveMessage(
    params: { sessionId: string; runtimeResumeToken?: string; message: CreateAgentSessionMessageDto },
    db?: DbOrTx
  ): Promise<AgentSessionMessageEntity> {
    const timestampMs = Date.now()
    if (db) return this.saveMessageTx(db, params, timestampMs)
    return application.get('DbService').withWriteTx((tx) => this.saveMessageTx(tx, params, timestampMs))
  }

  async saveMessages(params: CreateAgentSessionMessagesDto): Promise<AgentSessionMessageEntity[]> {
    const { sessionId, runtimeResumeToken, messages } = params

    return application.get('DbService').withWriteTx(async (tx) => {
      const timestampMs = Date.now()
      const saved: AgentSessionMessageEntity[] = []
      for (const message of messages) {
        saved.push(await this.upsertMessage(tx, { sessionId, runtimeResumeToken, message }, timestampMs))
      }
      await this.touchSessionUpdatedAt(tx, sessionId, timestampMs)
      return saved
    })
  }
}

export const agentSessionMessageService = new AgentSessionMessageService()
