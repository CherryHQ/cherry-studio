import { randomUUID } from 'node:crypto'

import { application } from '@application'
import {
  type AgentSessionMessageRow as SessionMessageRow,
  agentSessionMessageTable as sessionMessagesTable,
  type InsertAgentSessionMessageRow as InsertSessionMessageRow
} from '@data/db/schemas/agentSessionMessage'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import { timestampToISO } from '@data/services/utils/rowMappers'
import { loggerService } from '@logger'
import { DataApiErrorFactory } from '@shared/data/api'
import type {
  AgentMessageAssistantPersistPayload,
  AgentMessagePersistExchangePayload,
  AgentMessagePersistExchangeResult,
  AgentMessageUserPersistPayload,
  AgentPersistedMessage,
  AgentSessionMessageEntity,
  ListOptions
} from '@types'
import { and, asc, desc, eq, isNotNull, sql } from 'drizzle-orm'

const logger = loggerService.withContext('SessionMessageService')

export class AgentSessionMessageService {
  async sessionMessageExists(id: number): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    return result.length > 0
  }

  async listSessionMessages(
    sessionId: string,
    options: ListOptions = {}
  ): Promise<{ messages: AgentSessionMessageEntity[] }> {
    const database = application.get('DbService').getDb()
    const baseQuery = database
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.sessionId, sessionId))
      .orderBy(sessionMessagesTable.createdAt)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const messages = result.map((row) => this.rowToEntity(row))

    return { messages }
  }

  async deleteSessionMessage(sessionId: string, messageId: number): Promise<boolean> {
    const database = application.get('DbService').getDb()
    const result = await withSqliteErrors(
      () =>
        database
          .delete(sessionMessagesTable)
          .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.sessionId, sessionId))),
      defaultHandlersFor('Message', String(messageId))
    )
    return result.rowsAffected > 0
  }

  private rowToEntity(row: SessionMessageRow): AgentSessionMessageEntity {
    return {
      id: row.id,
      sessionId: row.sessionId,
      role: row.role as AgentSessionMessageEntity['role'],
      content: row.content,
      agentSessionId: row.agentSessionId ?? '',
      metadata: row.metadata ?? undefined,
      createdAt: timestampToISO(row.createdAt),
      updatedAt: timestampToISO(row.updatedAt)
    }
  }

  async getLastAgentSessionId(sessionId: string): Promise<string> {
    try {
      const database = application.get('DbService').getDb()
      const result = await database
        .select({ agentSessionId: sessionMessagesTable.agentSessionId })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.sessionId, sessionId), isNotNull(sessionMessagesTable.agentSessionId)))
        .orderBy(desc(sessionMessagesTable.createdAt))
        .limit(1)

      logger.silly('Last agent session ID result:', { agentSessionId: result[0]?.agentSessionId, sessionId })
      return result[0]?.agentSessionId || ''
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
    sessionId: string,
    role: string,
    messageId: string
  ): Promise<SessionMessageRow | null> {
    const database = application.get('DbService').getDb()
    const rows = await database
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
    params:
      | (AgentMessageUserPersistPayload & { sessionId: string; agentSessionId?: string })
      | (AgentMessageAssistantPersistPayload & { sessionId: string; agentSessionId: string })
  ): Promise<AgentSessionMessageEntity> {
    const { sessionId, agentSessionId = '', payload, metadata } = params

    if (!payload?.message?.role) {
      throw DataApiErrorFactory.validation({ role: ['is required'] }, 'Message payload missing role')
    }

    if (!payload.message.id) {
      throw DataApiErrorFactory.validation({ id: ['is required'] }, 'Message payload missing id')
    }

    const database = application.get('DbService').getDb()
    const existingRow = await this.findExistingMessageRow(sessionId, payload.message.role, payload.message.id)

    if (existingRow) {
      const metadataToPersist = metadata ?? existingRow.metadata ?? undefined
      const agentSessionToPersist = agentSessionId || existingRow.agentSessionId || ''
      const updatedAtMs = Date.now()

      await database
        .update(sessionMessagesTable)
        .set({
          content: payload,
          metadata: metadataToPersist,
          agentSessionId: agentSessionToPersist,
          updatedAt: updatedAtMs
        })
        .where(eq(sessionMessagesTable.id, existingRow.id))

      return this.rowToEntity({
        ...existingRow,
        content: payload,
        metadata: metadataToPersist ?? null,
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

    const [saved] = await database.insert(sessionMessagesTable).values(insertData).returning()
    return this.rowToEntity(saved)
  }

  async persistUserMessage(
    params: AgentMessageUserPersistPayload & { sessionId: string; agentSessionId?: string }
  ): Promise<AgentSessionMessageEntity> {
    return this.upsertMessage({ ...params, agentSessionId: params.agentSessionId ?? '' })
  }

  async persistAssistantMessage(
    params: AgentMessageAssistantPersistPayload & { sessionId: string; agentSessionId: string }
  ): Promise<AgentSessionMessageEntity> {
    return this.upsertMessage(params)
  }

  async persistExchange(params: AgentMessagePersistExchangePayload): Promise<AgentMessagePersistExchangeResult> {
    const { sessionId, agentSessionId, user, assistant } = params
    const exchangeResult: AgentMessagePersistExchangeResult = {}

    if (user?.payload) {
      exchangeResult.userMessage = await this.persistUserMessage({
        sessionId,
        agentSessionId,
        payload: user.payload,
        metadata: user.metadata,
        createdAt: user.createdAt
      })
    }

    if (assistant?.payload) {
      exchangeResult.assistantMessage = await this.persistAssistantMessage({
        sessionId,
        agentSessionId,
        payload: assistant.payload,
        metadata: assistant.metadata,
        createdAt: assistant.createdAt
      })
    }

    return exchangeResult
  }

  async getSessionHistory(sessionId: string): Promise<AgentPersistedMessage[]> {
    try {
      const database = application.get('DbService').getDb()
      const rows = await database
        .select()
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.sessionId, sessionId))
        .orderBy(asc(sessionMessagesTable.createdAt))

      const messages: AgentPersistedMessage[] = []
      for (const row of rows) {
        if (row?.content) {
          messages.push(row.content)
        }
      }

      logger.info(`Loaded ${messages.length} messages for session ${sessionId}`)
      return messages
    } catch (error) {
      logger.error('Failed to load session history', error as Error)
      throw error
    }
  }

  /** Persist a complete user+assistant exchange for headless callers (channels, scheduler). */
  async persistHeadlessExchange(
    sessionId: string,
    agentId: string,
    modelId: string,
    agentSessionId: string,
    userContent: string,
    assistantContent: string,
    images?: Array<{ data: string; media_type: string }>
  ): Promise<{ userMessage?: AgentSessionMessageEntity; assistantMessage?: AgentSessionMessageEntity }> {
    const now = new Date().toISOString()
    const userMsgId = randomUUID()
    const assistantMsgId = randomUUID()
    const userBlockId = randomUUID()
    const assistantBlockId = randomUUID()
    const topicId = `agent-session:${sessionId}`

    const imageBlocks: Array<{
      id: string
      messageId: string
      type: string
      createdAt: string
      status: string
      url: string
    }> = []
    if (images && images.length > 0) {
      for (const img of images) {
        imageBlocks.push({
          id: randomUUID(),
          messageId: userMsgId,
          type: 'image',
          createdAt: now,
          status: 'success',
          url: `data:${img.media_type};base64,${img.data}`
        })
      }
    }

    const userPayload = {
      message: {
        id: userMsgId,
        role: 'user' as const,
        assistantId: agentId,
        topicId,
        createdAt: now,
        status: 'success',
        blocks: [userBlockId, ...imageBlocks.map((b) => b.id)]
      },
      blocks: [
        {
          id: userBlockId,
          messageId: userMsgId,
          type: 'main_text',
          createdAt: now,
          status: 'success',
          content: userContent
        },
        ...imageBlocks
      ]
    } as AgentPersistedMessage

    const assistantPayload = {
      message: {
        id: assistantMsgId,
        role: 'assistant' as const,
        assistantId: agentId,
        topicId,
        createdAt: now,
        status: 'success',
        blocks: [assistantBlockId],
        modelId
      },
      blocks: [
        {
          id: assistantBlockId,
          messageId: assistantMsgId,
          type: 'main_text',
          createdAt: now,
          status: 'success',
          content: assistantContent
        }
      ]
    } as AgentPersistedMessage

    return this.persistExchange({
      sessionId,
      agentSessionId,
      user: { payload: userPayload, createdAt: now },
      assistant: { payload: assistantPayload, createdAt: now }
    })
  }
}

export const agentSessionMessageService = new AgentSessionMessageService()
