import { loggerService } from '@logger'
import type {
  AgentMessageAssistantPersistPayload,
  AgentMessagePersistExchangePayload,
  AgentMessagePersistExchangeResult,
  AgentMessageUserPersistPayload,
  AgentPersistedMessage,
  AgentSessionMessageEntity
} from '@types'

import { BaseService } from '../BaseService'
import type { InsertSessionMessageRow } from './schema'
import { sessionMessagesTable } from './schema'

const logger = loggerService.withContext('AgentMessageRepository')

type TxClient = any

export type PersistUserMessageParams = AgentMessageUserPersistPayload & {
  sessionId: string
  agentSessionId?: string
  tx?: TxClient
}

export type PersistAssistantMessageParams = AgentMessageAssistantPersistPayload & {
  sessionId: string
  agentSessionId: string
  tx?: TxClient
}

type PersistExchangeParams = AgentMessagePersistExchangePayload & {
  tx?: TxClient
}

type PersistExchangeResult = AgentMessagePersistExchangeResult

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

  private getWriter(tx?: TxClient): TxClient {
    return tx ?? this.database
  }

  async persistUserMessage(params: PersistUserMessageParams): Promise<AgentSessionMessageEntity> {
    await AgentMessageRepository.initialize()
    this.ensureInitialized()

    const writer = this.getWriter(params.tx)
    const now = params.createdAt ?? params.payload.message.createdAt ?? new Date().toISOString()

    const insertData: InsertSessionMessageRow = {
      session_id: params.sessionId,
      role: params.payload.message.role,
      content: this.serializeMessage(params.payload),
      agent_session_id: params.agentSessionId ?? '',
      metadata: this.serializeMetadata(params.metadata),
      created_at: now,
      updated_at: now
    }

    const [saved] = await writer.insert(sessionMessagesTable).values(insertData).returning()

    return this.deserialize(saved)
  }

  async persistAssistantMessage(params: PersistAssistantMessageParams): Promise<AgentSessionMessageEntity> {
    await AgentMessageRepository.initialize()
    this.ensureInitialized()

    const writer = this.getWriter(params.tx)
    const now = params.createdAt ?? params.payload.message.createdAt ?? new Date().toISOString()

    const insertData: InsertSessionMessageRow = {
      session_id: params.sessionId,
      role: params.payload.message.role,
      content: this.serializeMessage(params.payload),
      agent_session_id: params.agentSessionId,
      metadata: this.serializeMetadata(params.metadata),
      created_at: now,
      updated_at: now
    }

    const [saved] = await writer.insert(sessionMessagesTable).values(insertData).returning()

    return this.deserialize(saved)
  }

  async persistExchange(params: PersistExchangeParams): Promise<PersistExchangeResult> {
    await AgentMessageRepository.initialize()
    this.ensureInitialized()

    const { sessionId, agentSessionId, user, assistant } = params

    const result = await this.database.transaction(async (tx) => {
      const exchangeResult: PersistExchangeResult = {}

      if (user?.payload) {
        if (!user.payload.message?.role) {
          throw new Error('User message payload missing role')
        }
        exchangeResult.userMessage = await this.persistUserMessage({
          sessionId,
          agentSessionId,
          payload: user.payload,
          metadata: user.metadata,
          createdAt: user.createdAt,
          tx
        })
      }

      if (assistant?.payload) {
        if (!assistant.payload.message?.role) {
          throw new Error('Assistant message payload missing role')
        }
        exchangeResult.assistantMessage = await this.persistAssistantMessage({
          sessionId,
          agentSessionId,
          payload: assistant.payload,
          metadata: assistant.metadata,
          createdAt: assistant.createdAt,
          tx
        })
      }

      return exchangeResult
    })

    return result
  }
}

export const agentMessageRepository = AgentMessageRepository.getInstance()
