import { loggerService } from '@logger'
import type { SessionMessageEntity } from '@types'

import { BaseService } from '../BaseService'
import { AgentQueries_Legacy as AgentQueries } from '../database'

const logger = loggerService.withContext('SessionMessageService')

export interface CreateSessionMessageRequest {
  session_id: string
  parent_id?: number
  role: 'user' | 'agent' | 'system' | 'tool'
  type: string
  content: Record<string, any>
  metadata?: Record<string, any>
}

export interface UpdateSessionMessageRequest {
  content?: Record<string, any>
  metadata?: Record<string, any>
}

export interface ListSessionMessagesOptions {
  limit?: number
  offset?: number
}

export class SessionMessageService extends BaseService {
  private static instance: SessionMessageService | null = null

  static getInstance(): SessionMessageService {
    if (!SessionMessageService.instance) {
      SessionMessageService.instance = new SessionMessageService()
    }
    return SessionMessageService.instance
  }

  async initialize(): Promise<void> {
    await BaseService.initialize()
  }

  async createSessionMessage(messageData: CreateSessionMessageRequest): Promise<SessionMessageEntity> {
    this.ensureInitialized()

    // Validate session exists - we'll need to import SessionService for this check
    // For now, we'll skip this validation to avoid circular dependencies
    // The database foreign key constraint will handle this

    // Validate parent exists if specified
    if (messageData.parent_id) {
      const parentExists = await this.sessionMessageExists(messageData.parent_id)
      if (!parentExists) {
        throw new Error(`Parent message with id ${messageData.parent_id} does not exist`)
      }
    }

    const now = new Date().toISOString()

    const values = [
      messageData.session_id,
      messageData.parent_id || null,
      messageData.role,
      messageData.type,
      JSON.stringify(messageData.content),
      messageData.metadata ? JSON.stringify(messageData.metadata) : null,
      now,
      now
    ]

    const result = await this.database.execute({
      sql: AgentQueries.sessionMessages.insert,
      args: values
    })

    if (!result.lastInsertRowid) {
      throw new Error('Failed to create session message')
    }

    const logResult = await this.database.execute({
      sql: AgentQueries.sessionMessages.getById,
      args: [result.lastInsertRowid]
    })

    if (!logResult.rows[0]) {
      throw new Error('Failed to retrieve created session message')
    }

    return this.deserializeSessionMessage(logResult.rows[0]) as SessionMessageEntity
  }

  async getSessionMessage(id: number): Promise<SessionMessageEntity | null> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.sessionMessages.getById,
      args: [id]
    })

    if (!result.rows[0]) {
      return null
    }

    return this.deserializeSessionMessage(result.rows[0]) as SessionMessageEntity
  }

  async listSessionMessages(
    sessionId: string,
    options: ListSessionMessagesOptions = {}
  ): Promise<{ messages: SessionMessageEntity[]; total: number }> {
    this.ensureInitialized()

    // Get total count
    const countResult = await this.database.execute({
      sql: AgentQueries.sessionMessages.countBySessionId,
      args: [sessionId]
    })
    const total = (countResult.rows[0] as any).total

    // Get messages with pagination
    let query: string
    const args: any[] = [sessionId]

    if (options.limit !== undefined) {
      query = AgentQueries.sessionMessages.getBySessionIdWithPagination
      args.push(options.limit)

      if (options.offset !== undefined) {
        args.push(options.offset)
      } else {
        args.push(0)
      }
    } else {
      query = AgentQueries.sessionMessages.getBySessionId
    }

    const result = await this.database.execute({
      sql: query,
      args: args
    })

    const messages = result.rows.map((row) => this.deserializeSessionMessage(row)) as SessionMessageEntity[]

    return { messages, total }
  }

  async updateSessionMessage(id: number, updates: UpdateSessionMessageRequest): Promise<SessionMessageEntity | null> {
    this.ensureInitialized()

    // Check if message exists
    const existing = await this.getSessionMessage(id)
    if (!existing) {
      return null
    }

    const now = new Date().toISOString()

    const values = [
      updates.content !== undefined ? JSON.stringify(updates.content) : JSON.stringify(existing.content),
      updates.metadata !== undefined
        ? updates.metadata
          ? JSON.stringify(updates.metadata)
          : null
        : existing.metadata
          ? JSON.stringify(existing.metadata)
          : null,
      now,
      id
    ]

    await this.database.execute({
      sql: AgentQueries.sessionMessages.update,
      args: values
    })

    return await this.getSessionMessage(id)
  }

  async deleteSessionMessage(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.sessionMessages.deleteById,
      args: [id]
    })

    return result.rowsAffected > 0
  }

  async sessionMessageExists(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.execute({
      sql: AgentQueries.sessionMessages.getById,
      args: [id]
    })

    return result.rows.length > 0
  }

  async bulkCreateSessionMessages(messages: CreateSessionMessageRequest[]): Promise<SessionMessageEntity[]> {
    this.ensureInitialized()

    const results: SessionMessageEntity[] = []

    // Use a transaction for bulk insert
    for (const messageData of messages) {
      const result = await this.createSessionMessage(messageData)
      results.push(result)
    }

    return results
  }

  private deserializeSessionMessage(data: any): SessionMessageEntity {
    if (!data) return data

    const deserialized = { ...data }

    // Parse content JSON
    if (deserialized.content && typeof deserialized.content === 'string') {
      try {
        deserialized.content = JSON.parse(deserialized.content)
      } catch (error) {
        logger.warn(`Failed to parse content JSON:`, error as Error)
      }
    }

    // Parse metadata JSON
    if (deserialized.metadata && typeof deserialized.metadata === 'string') {
      try {
        deserialized.metadata = JSON.parse(deserialized.metadata)
      } catch (error) {
        logger.warn(`Failed to parse metadata JSON:`, error as Error)
      }
    }

    return deserialized
  }
}

export const sessionMessageService = SessionMessageService.getInstance()
