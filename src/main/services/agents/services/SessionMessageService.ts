import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'
import type { AgentSessionEntity, SessionMessageEntity } from '@types'
import { UIMessageChunk } from 'ai'
import { count, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { type InsertSessionMessageRow, sessionMessagesTable } from '../database/schema'
import ClaudeCodeService from './claudecode'

const logger = loggerService.withContext('SessionMessageService')

export interface CreateSessionMessageRequest {
  session_id: string
  parent_id?: number
  role: 'user' | 'agent' | 'system' | 'tool'
  type: string
  content: string
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

  async sessionMessageExists(id: number): Promise<boolean> {
    this.ensureInitialized()

    const result = await this.database
      .select({ id: sessionMessagesTable.id })
      .from(sessionMessagesTable)
      .where(eq(sessionMessagesTable.id, id))
      .limit(1)

    return result.length > 0
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

  createSessionMessageStream(session: AgentSessionEntity, messageData: CreateSessionMessageRequest): EventEmitter {
    this.ensureInitialized()

    // Create a new EventEmitter to manage the session message lifecycle
    const sessionStream = new EventEmitter()

    // Validate parent exists if specified
    if (messageData.parent_id) {
      this.sessionMessageExists(messageData.parent_id)
        .then((exists) => {
          if (!exists) {
            process.nextTick(() => {
              sessionStream.emit('data', {
                type: 'error',
                error: new Error(`Parent message with id ${messageData.parent_id} does not exist`)
              })
            })
            return
          }

          // Start the Claude Code stream after validation passes
          this.startClaudeCodeStream(session, messageData, sessionStream)
        })
        .catch((error) => {
          process.nextTick(() => {
            sessionStream.emit('data', {
              type: 'error',
              error: error as Error
            })
          })
        })
    } else {
      // No parent validation needed, start immediately
      this.startClaudeCodeStream(session, messageData, sessionStream)
    }

    return sessionStream
  }

  private startClaudeCodeStream(
    session: AgentSessionEntity,
    messageData: CreateSessionMessageRequest,
    sessionStream: EventEmitter
  ): void {
    const cc = new ClaudeCodeService()

    // Create the streaming Claude Code invocation
    const claudeStream = cc.invokeStream(
      messageData.content,
      session.accessible_paths[0],
      session.external_session_id,
      {
        permissionMode: session.permission_mode,
        maxTurns: session.max_steps
      }
    )

    let sessionMessage: SessionMessageEntity | null = null

    // Handle Claude Code stream events
    claudeStream.on('data', async (event: any) => {
      try {
        switch (event.type) {
          case 'chunk':
            // Forward UIMessageChunk directly
            sessionStream.emit('data', {
              type: 'chunk',
              chunk: event.chunk as UIMessageChunk
            })
            break

          case 'error':
            sessionStream.emit('data', {
              type: 'error',
              error: event.error
            })
            break

          case 'complete': {
            // Save the final message to database when Claude Code completes
            logger.info('Claude Code stream completed, saving message to database')

            const now = new Date().toISOString()
            const insertData: InsertSessionMessageRow = {
              session_id: messageData.session_id,
              parent_id: messageData.parent_id || null,
              role: messageData.role,
              type: messageData.type,
              content: JSON.stringify(event.result),
              metadata: messageData.metadata ? JSON.stringify(messageData.metadata) : null,
              created_at: now,
              updated_at: now
            }

            const result = await this.database.insert(sessionMessagesTable).values(insertData).returning()

            if (result[0]) {
              sessionMessage = this.deserializeSessionMessage(result[0]) as SessionMessageEntity
              logger.info(`Session message saved with ID: ${sessionMessage.id}`)

              // Emit the complete event with the saved message
              sessionStream.emit('data', {
                type: 'complete',
                result: event.result,
                message: sessionMessage
              })
            } else {
              sessionStream.emit('data', {
                type: 'error',
                error: new Error('Failed to save session message to database')
              })
            }
            break
          }

          default:
            logger.warn('Unknown event type from Claude Code service:', { type: event.type })
            break
        }
      } catch (error) {
        logger.error('Error handling Claude Code stream event:', { error })
        sessionStream.emit('data', {
          type: 'error',
          error: error as Error
        })
      }
    })
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
