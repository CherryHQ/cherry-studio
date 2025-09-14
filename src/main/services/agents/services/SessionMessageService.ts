import { loggerService } from '@logger'
import type { SessionMessageEntity } from '@types'
import { count, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type InsertSessionMessageRow, type SessionMessageRow, sessionMessagesTable } from '../database/schema'

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

    const insertData: InsertSessionMessageRow = {
      session_id: messageData.session_id,
      parent_id: messageData.parent_id || null,
      role: messageData.role,
      type: messageData.type,
      content: JSON.stringify(messageData.content),
      metadata: messageData.metadata ? JSON.stringify(messageData.metadata) : null,
      created_at: now,
      updated_at: now
    }

    const result = await this.database.insert(sessionMessagesTable).values(insertData).returning()

    if (!result[0]) {
      throw new Error('Failed to create session message')
    }

    return this.deserializeSessionMessage(result[0]) as SessionMessageEntity
  }

  async getSessionMessage(id: number): Promise<SessionMessageEntity | null> {
    this.ensureInitialized()

    const result = await this.database
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    if (!result[0]) {
      return null
    }

    return this.deserializeSessionMessage(result[0]) as SessionMessageEntity
  }

  async listSessionMessages(
    sessionId: string,
    options: ListSessionMessagesOptions = {}
  ): Promise<{ messages: SessionMessageEntity[]; total: number }> {
    this.ensureInitialized()

    // Get total count
    const totalResult = await this.database
      .select({ count: count() })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.session_id, sessionId))

    const total = totalResult[0].count

    // Get messages with pagination
    const baseQuery = this.database
      .select()
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.session_id, sessionId))
      .orderBy(sessionMessagesTable.created_at)

    const result =
      options.limit !== undefined
        ? options.offset !== undefined
          ? await baseQuery.limit(options.limit).offset(options.offset)
          : await baseQuery.limit(options.limit)
        : await baseQuery

    const messages = result.map((row) => this.deserializeSessionMessage(row)) as SessionMessageEntity[]

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

    const updateData: Partial<SessionMessageRow> = {
      updated_at: now
    }

    if (updates.content !== undefined) {
      updateData.content = JSON.stringify(updates.content)
    }

    if (updates.metadata !== undefined) {
      updateData.metadata = updates.metadata ? JSON.stringify(updates.metadata) : null
    }

    await this.database.update(sessionMessagesTable).set(updateData).where(eq(sessionMessagesTable.id, id))

    return await this.getSessionMessage(id)
  }

  async deleteSessionMessage(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database.delete(sessionMessagesTable).where(eq(sessionMessagesTable.id, id))

    return result.rowsAffected > 0
  }

  async sessionMessageExists(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    return result.length > 0
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
