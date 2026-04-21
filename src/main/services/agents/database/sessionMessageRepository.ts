import { loggerService } from '@logger'
import type {
  AgentMessageAssistantPersistPayload,
  AgentMessagePersistExchangePayload,
  AgentMessagePersistExchangeResult,
  AgentMessageUserPersistPayload,
  AgentPersistedMessage,
  AgentSessionMessageEntity
} from '@types'
import { and, asc, desc, eq, ne, sql } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import type { InsertSessionMessageRow, SessionMessageRow } from './schema'
import { sessionMessagesTable } from './schema'

const logger = loggerService.withContext('AgentMessageRepository')

export type PersistUserMessageParams = AgentMessageUserPersistPayload & {
  sessionId: string
  agentSessionId?: string
}

export type PersistAssistantMessageParams = AgentMessageAssistantPersistPayload & {
  sessionId: string
  agentSessionId: string
}

class AgentMessageRepository extends BaseService {
  // Drizzle serializes/deserializes content and metadata automatically via
  // `{ mode: 'json' }` on the schema — no manual JSON.stringify/parse here.

  private async findExistingMessageRow(
    sessionId: string,
    role: string,
    messageId: string
  ): Promise<SessionMessageRow | null> {
    const database = await this.getDatabase()
    // Use SQLite json_extract to query by messageId directly, avoiding loading all messages
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
    params: PersistUserMessageParams | PersistAssistantMessageParams
  ): Promise<AgentSessionMessageEntity> {
    const { sessionId, agentSessionId = '', payload, metadata } = params

    if (!payload?.message?.role) {
      throw new Error('Message payload missing role')
    }

    if (!payload.message.id) {
      throw new Error('Message payload missing id')
    }

    const database = await this.getDatabase()

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

      return this.toEntity({
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

    return this.toEntity(saved)
  }

  private toEntity(row: SessionMessageRow): AgentSessionMessageEntity {
    return row as unknown as AgentSessionMessageEntity
  }

  async persistUserMessage(params: PersistUserMessageParams): Promise<AgentSessionMessageEntity> {
    return this.upsertMessage({ ...params, agentSessionId: params.agentSessionId ?? '' })
  }

  async persistAssistantMessage(params: PersistAssistantMessageParams): Promise<AgentSessionMessageEntity> {
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

  /**
   * Get the last non-empty agent_session_id for a session.
   * Used to resume Claude Code SDK sessions across app restarts.
   */
  async getLastAgentSessionId(sessionId: string): Promise<string | undefined> {
    const database = await this.getDatabase()
    const [row] = await database
      .select({ agentSessionId: sessionMessagesTable.agent_session_id })
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.session_id, sessionId), ne(sessionMessagesTable.agent_session_id, '')))
      .orderBy(desc(sessionMessagesTable.created_at))
      .limit(1)
    return row?.agentSessionId ?? undefined
  }

  async getSessionHistory(sessionId: string): Promise<AgentPersistedMessage[]> {
    try {
      const database = await this.getDatabase()
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
}

export const agentMessageRepository = new AgentMessageRepository()
