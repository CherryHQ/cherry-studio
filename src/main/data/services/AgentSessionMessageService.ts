import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { agentSessionTable as sessionTable } from '@data/db/schemas/agentSession'
import {
  type AgentSessionMessageRow as SessionMessageRow,
  agentSessionMessageTable as sessionMessagesTable,
  type InsertAgentSessionMessageRow as InsertSessionMessageRow
} from '@data/db/schemas/agentSessionMessage'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { decodeCursor, encodeCursor } from '@data/services/utils/cursor'
import { nullsToUndefined, timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type { CursorPaginationResponse } from '@shared/data/api/apiTypes'
import type { AgentSessionMessageEntity } from '@shared/data/api/schemas/agents'
import { SESSION_MESSAGES_DEFAULT_LIMIT, SESSION_MESSAGES_MAX_LIMIT } from '@shared/data/api/schemas/sessions'
import type {
  AgentMessageExchangeInput,
  AgentMessageExchangeOutput,
  AgentMessagePersistInput,
  AgentPersistedMessage
} from '@shared/data/types/agentMessage'
import type { CherryMessagePart } from '@shared/data/types/message'
import { and, desc, eq, isNotNull, lt, or, sql } from 'drizzle-orm'

const logger = loggerService.withContext('SessionMessageService')

function decodeMessageCursor(raw: string): { createdAt: number; id: string } | null {
  const decoded = decodeCursor(raw)
  if (!decoded) return null
  const createdAt = Number(decoded.key)
  if (!Number.isFinite(createdAt)) return null
  return { createdAt, id: decoded.id }
}

export class AgentSessionMessageService {
  async sessionMessageExists(id: string): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    return result.length > 0
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

    const limit = Math.min(options.limit ?? SESSION_MESSAGES_DEFAULT_LIMIT, SESSION_MESSAGES_MAX_LIMIT)
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
    const nextCursor = hasNext && tail ? encodeCursor(String(tail.createdAt), tail.id) : undefined

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
      () =>
        database
          .delete(sessionMessagesTable)
          .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId))),
      defaultHandlersFor('Message', messageId)
    )
    if (result.rowsAffected === 0) {
      throw DataApiErrorFactory.notFound('Message', messageId)
    }
  }

  private rowToEntity(row: SessionMessageRow): AgentSessionMessageEntity {
    const clean = nullsToUndefined(row)
    return {
      ...clean,
      role: row.role as AgentSessionMessageEntity['role'],
      // NULL = "no upstream session yet" — preserve, do not coerce to ''.
      agentSessionId: row.agentSessionId,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  async getLastAgentSessionId(sessionId: string): Promise<string | null> {
    try {
      const database = application.get('DbService').getDb()
      const result = await database
        .select({ agentSessionId: sessionMessagesTable.agentSessionId })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), isNotNull(sessionMessagesTable.agentSessionId)))
        .orderBy(desc(sessionMessagesTable.createdAt))
        .limit(1)

      logger.silly('Last agent session ID result:', { agentSessionId: result[0]?.agentSessionId, sessionId })
      return result[0]?.agentSessionId ?? null
    } catch (error) {
      logger.error('Failed to get last agent session ID', {
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
    role: string,
    messageId: string
  ): Promise<SessionMessageRow | null> {
    const rows = await db
      .select()
      .from(sessionMessagesTable)
      .where(
        and(
          eq(sessionMessagesTable.sessionId, sessionId),
          eq(sessionMessagesTable.role, role),
          sql`json_extract(${sessionMessagesTable.content}, '$.message.id') = ${messageId}`
        )
      )
      .limit(1)

    return rows[0] ?? null
  }

  private async upsertMessage(
    db: DbOrTx,
    params:
      | (AgentMessagePersistInput & { sessionId: string; agentSessionId?: string | null })
      | (AgentMessagePersistInput & { sessionId: string; agentSessionId: string | null })
  ): Promise<AgentSessionMessageEntity> {
    const { sessionId, agentSessionId = null, payload, metadata } = params

    if (!payload?.message?.role) {
      throw DataApiErrorFactory.validation({ role: ['is required'] }, 'Message payload missing role')
    }

    if (!payload.message.id) {
      throw DataApiErrorFactory.validation({ id: ['is required'] }, 'Message payload missing id')
    }

    const existingRow = await this.findExistingMessageRow(db, sessionId, payload.message.role, payload.message.id)

    if (existingRow) {
      // undefined → keep existing; null → clear; object → replace.
      const metadataToPersist = metadata === undefined ? existingRow.metadata : metadata
      const agentSessionToPersist = agentSessionId ?? existingRow.agentSessionId ?? null
      const updatedAtMs = Date.now()

      await withSqliteErrors(
        () =>
          db
            .update(sessionMessagesTable)
            .set({
              content: payload,
              metadata: metadataToPersist,
              agentSessionId: agentSessionToPersist,
              updatedAt: updatedAtMs
            })
            .where(eq(sessionMessagesTable.id, existingRow.id)),
        defaultHandlersFor('Message', String(existingRow.id))
      )

      return this.rowToEntity({
        ...existingRow,
        content: payload,
        metadata: metadataToPersist,
        agentSessionId: agentSessionToPersist,
        updatedAt: updatedAtMs
      })
    }

    const insertData: InsertSessionMessageRow = {
      sessionId,
      role: payload.message.role,
      content: payload,
      agentSessionId,
      metadata
    }

    const [saved] = await db.insert(sessionMessagesTable).values(insertData).returning()
    return this.rowToEntity(saved)
  }

  async persistUserMessage(
    params: AgentMessagePersistInput & { sessionId: string; agentSessionId?: string | null },
    db?: DbOrTx
  ): Promise<AgentSessionMessageEntity> {
    const database = db ?? application.get('DbService').getDb()
    return this.upsertMessage(database, { ...params, agentSessionId: params.agentSessionId ?? null })
  }

  async persistAssistantMessage(
    params: AgentMessagePersistInput & { sessionId: string; agentSessionId: string | null },
    db?: DbOrTx
  ): Promise<AgentSessionMessageEntity> {
    const database = db ?? application.get('DbService').getDb()
    return this.upsertMessage(database, params)
  }

  async persistExchange(params: AgentMessageExchangeInput): Promise<AgentMessageExchangeOutput> {
    const { sessionId, agentSessionId, user, assistant } = params
    const database = application.get('DbService').getDb()

    return database.transaction(async (tx) => {
      const exchangeResult: AgentMessageExchangeOutput = {}

      if (user?.payload) {
        exchangeResult.userMessage = await this.persistUserMessage(
          {
            sessionId,
            agentSessionId,
            payload: user.payload,
            metadata: user.metadata,
            createdAt: user.createdAt
          },
          tx
        )
      }

      if (assistant?.payload) {
        exchangeResult.assistantMessage = await this.persistAssistantMessage(
          {
            sessionId,
            agentSessionId,
            payload: assistant.payload,
            metadata: assistant.metadata,
            createdAt: assistant.createdAt
          },
          tx
        )
      }

      return exchangeResult
    })
  }

  /** Persist a complete user+assistant exchange for headless callers (channels, scheduler). */
  async persistHeadlessExchange(
    sessionId: string,
    agentId: string,
    modelId: string | undefined,
    agentSessionId: string | null,
    userContent: string,
    assistantContent: string,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<{ userMessage?: AgentSessionMessageEntity; assistantMessage?: AgentSessionMessageEntity }> {
    const now = new Date().toISOString()
    const userMsgId = randomUUID()
    const assistantMsgId = randomUUID()
    const topicId = `agent-session:${sessionId}`

    // v2 envelope: parts under `data.parts`, `blocks` empty.
    const userParts: CherryMessagePart[] = [{ type: 'text', text: userContent, state: 'done' }]
    if (images && images.length > 0) {
      for (const img of images) {
        userParts.push({
          type: 'file',
          mediaType: img.media_type,
          url: `data:${img.media_type};base64,${img.data}`
        })
      }
    }

    const userPayload: AgentPersistedMessage = {
      message: {
        id: userMsgId,
        role: 'user',
        assistantId: agentId,
        topicId,
        createdAt: now,
        status: 'success',
        data: { parts: userParts }
      },
      blocks: []
    }

    const assistantPayload: AgentPersistedMessage = {
      message: {
        id: assistantMsgId,
        role: 'assistant',
        assistantId: agentId,
        topicId,
        createdAt: now,
        status: 'success',
        modelId,
        data: { parts: [{ type: 'text', text: assistantContent, state: 'done' }] }
      },
      blocks: []
    }

    return this.persistExchange({
      sessionId,
      agentSessionId,
      user: { payload: userPayload, createdAt: now },
      assistant: { payload: assistantPayload, createdAt: now }
    })
  }
}

export const agentSessionMessageService = new AgentSessionMessageService()
