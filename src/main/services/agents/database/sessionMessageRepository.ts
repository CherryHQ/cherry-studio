import { loggerService } from '@logger'
import type {
  AgentMessageAssistantPersistPayload,
  AgentMessagePersistExchangePayload,
  AgentMessagePersistExchangeResult,
  AgentMessageUserPersistPayload,
  AgentPersistedMessage,
  AgentSessionMessageEntity
} from '@types'
import { and, asc, eq } from 'drizzle-orm'

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
  private static instance: AgentMessageRepository | null = null

  static getInstance(): AgentMessageRepository {
    if (!AgentMessageRepository.instance) {
      AgentMessageRepository.instance = new AgentMessageRepository()
    }

    return AgentMessageRepository.instance
  }

  private serializeMessage(payload: AgentPersistedMessage): string {
    return JSON.stringify(payload)
  }

  private serializeMetadata(metadata?: Record<string, unknown>): string | undefined {
    if (!metadata) {
      return undefined
    }

    try {
      return JSON.stringify(metadata)
    } catch (error) {
      logger.warn('Failed to serialize session message metadata', error as Error)
      return undefined
    }
  }

  private deserialize(row: any): AgentSessionMessageEntity {
    if (!row) return row

    const deserialized = { ...row }

    if (typeof deserialized.content === 'string') {
      try {
        deserialized.content = JSON.parse(deserialized.content)
      } catch (error) {
        logger.warn('Failed to parse session message content JSON', error as Error)
      }
    }

    if (typeof deserialized.metadata === 'string') {
      try {
        deserialized.metadata = JSON.parse(deserialized.metadata)
      } catch (error) {
        logger.warn('Failed to parse session message metadata JSON', error as Error)
      }
    }

    return deserialized
  }

  private async findExistingMessageRow(
    sessionId: string,
    role: string,
    messageId: string
  ): Promise<SessionMessageRow | null> {
    const database = await this.getDatabase()
    const candidateRows: SessionMessageRow[] = await database
      .select()
      .from(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.session_id, sessionId), eq(sessionMessagesTable.role, role)))
      .orderBy(asc(sessionMessagesTable.created_at))

    for (const row of candidateRows) {
      if (!row?.content) continue

      try {
        const parsed = JSON.parse(row.content) as AgentPersistedMessage | undefined
        if (parsed?.message?.id === messageId) {
          return row
        }
      } catch (error) {
        logger.warn('Failed to parse session message content JSON during lookup', error as Error)
      }
    }

    return null
  }

  private async upsertMessage(
    params: PersistUserMessageParams | PersistAssistantMessageParams
  ): Promise<AgentSessionMessageEntity> {
    const { sessionId, agentSessionId = '', payload, metadata, createdAt } = params

    if (!payload?.message?.role) {
      throw new Error('Message payload missing role')
    }

    if (!payload.message.id) {
      throw new Error('Message payload missing id')
    }

    const database = await this.getDatabase()
    const now = createdAt ?? payload.message.createdAt ?? new Date().toISOString()
    const serializedPayload = this.serializeMessage(payload)
    const serializedMetadata = this.serializeMetadata(metadata)

    const existingRow = await this.findExistingMessageRow(sessionId, payload.message.role, payload.message.id)

    if (existingRow) {
      const metadataToPersist = serializedMetadata ?? existingRow.metadata ?? undefined
      const agentSessionToPersist = agentSessionId || existingRow.agent_session_id || ''

      await database
        .update(sessionMessagesTable)
        .set({
          content: serializedPayload,
          metadata: metadataToPersist,
          agent_session_id: agentSessionToPersist,
          updated_at: now
        })
        .where(eq(sessionMessagesTable.id, existingRow.id))

      return this.deserialize({
        ...existingRow,
        content: serializedPayload,
        metadata: metadataToPersist,
        agent_session_id: agentSessionToPersist,
        updated_at: now
      })
    }

    const insertData: InsertSessionMessageRow = {
      session_id: sessionId,
      role: payload.message.role,
      content: serializedPayload,
      agent_session_id: agentSessionId,
      metadata: serializedMetadata,
      created_at: now,
      updated_at: now
    }

    const [saved] = await database.insert(sessionMessagesTable).values(insertData).returning()

    return this.deserialize(saved)
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

  async getSessionHistory(sessionId: string): Promise<AgentPersistedMessage[]> {
    try {
      const database = await this.getDatabase()
      const rows = await database
        .select()
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.session_id, sessionId))
        .orderBy(asc(sessionMessagesTable.created_at))

      const messages: AgentPersistedMessage[] = []

      for (const row of rows) {
        const deserialized = this.deserialize(row)
        if (deserialized?.content) {
          messages.push(deserialized.content as AgentPersistedMessage)
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

export const agentMessageRepository = AgentMessageRepository.getInstance()
