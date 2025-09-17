import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'
import type {
  AgentSessionMessageEntity,
  CreateSessionMessageRequest,
  GetAgentSessionResponse,
  ListOptions,
} from '@types'
import { UIMessageChunk } from 'ai'
import { count, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { sessionMessagesTable } from '../database/schema'
import ClaudeCodeService from './claudecode'

const logger = loggerService.withContext('SessionMessageService')

export class SessionMessageService extends BaseService {
  private static instance: SessionMessageService | null = null
  private cc: ClaudeCodeService = new ClaudeCodeService()

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
    options: ListOptions = {}
  ): Promise<{ messages: AgentSessionMessageEntity[]; total: number }> {
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

    const messages = result.map((row) => this.deserializeSessionMessage(row)) as AgentSessionMessageEntity[]

    return { messages, total }
  }

  createSessionMessage(session: GetAgentSessionResponse, messageData: CreateSessionMessageRequest): EventEmitter {
    this.ensureInitialized()

    // Create a new EventEmitter to manage the session message lifecycle
    const sessionStream = new EventEmitter()

    // No parent validation needed, start immediately
    this.startSessionMessageStream(session, messageData, sessionStream)

    return sessionStream
  }

  private startSessionMessageStream(
    session: GetAgentSessionResponse,
    req: CreateSessionMessageRequest,
    sessionStream: EventEmitter
  ): void {
    const previousMessages = session.messages || []
    let session_id: string = ''
    if (previousMessages.length > 0) {
      session_id = previousMessages[0].session_id
    }

    logger.debug('Session Message stream message data:', { message: req, session_id })

    if (session.agent_type !== 'claude-code') {
      logger.error('Unsupported agent type for streaming:', { agent_type: session.agent_type })
      throw new Error('Unsupported agent type for streaming')
    }

    // Create the streaming agent invocation (using invokeStream for streaming)
    const claudeStream = this.cc.invoke(req.content, session.accessible_paths[0], session_id, {
      permissionMode: session.configuration?.permissionMode || 'default',
      maxTurns: session.configuration?.maxTurns || 10
    })

    const streamedChunks: UIMessageChunk[] = []
    const rawAgentMessages: any[] = [] // Generic agent messages storage

    // Handle agent stream events (agent-agnostic)
    claudeStream.on('data', async (event: any) => {
      try {
        switch (event.type) {
          case 'chunk':
            // Forward UIMessageChunk directly and collect raw agent messages
            if (event.chunk) {
              const chunk = event.chunk as UIMessageChunk
              streamedChunks.push(chunk)

              // Collect raw agent message if available (agent-agnostic)
              if (event.rawAgentMessage) {
                rawAgentMessages.push(event.rawAgentMessage)
              }

              sessionStream.emit('data', {
                type: 'chunk',
                chunk
              })
            } else {
              logger.warn('Received agent chunk event without chunk payload')
            }
            break

          case 'error':
            sessionStream.emit('data', {
              type: 'error',
              error: event.error || (event.data?.stderr ? new Error(event.data.stderr) : undefined)
            })
            break

          case 'complete': {
            // Save the final message to database when agent completes
            logger.info('Agent stream completed, saving message to database')

            // Extract additional raw agent messages from agentResult if available
            if (event.agentResult?.rawSDKMessages) {
              rawAgentMessages.push(...event.agentResult.rawSDKMessages)
            }

            // Create structured content with both AI SDK format and raw data
            const structuredContent = {
              aiSDKChunks: streamedChunks, // For UI consumption
              rawAgentMessages: rawAgentMessages, // Original agent-specific messages
              agentResult: event.agentResult, // Complete result from the agent
              agentType: event.agentResult?.agentType || 'unknown' // Store agent type for future reference
            }

            // const now = new Date().toISOString()
            // const insertData: InsertSessionMessageRow = {
            //   session_id: req.session_id,
            //   parent_id: req.parent_id || null,
            //   role: req.role,
            //   type: req.type,
            //   content: JSON.stringify(structuredContent),
            //   metadata: req.metadata
            //     ? JSON.stringify({
            //         ...req.metadata,
            //         chunkCount: streamedChunks.length,
            //         rawMessageCount: rawAgentMessages.length,
            //         agentType: event.agentResult?.agentType || 'unknown',
            //         completedAt: now
            //       })
            //     : JSON.stringify({
            //         chunkCount: streamedChunks.length,
            //         rawMessageCount: rawAgentMessages.length,
            //         agentType: event.agentResult?.agentType || 'unknown',
            //         completedAt: now
            //       }),
            //   created_at: now,
            //   updated_at: now
            // }

            // const result = await this.database.insert(sessionMessagesTable).values(insertData).returning()

            // if (result[0]) {
            //   sessionMessage = this.deserializeSessionMessage(result[0]) as AgentSessionMessageEntity
            //   logger.info(`Session message saved with ID: ${sessionMessage.id}`)

            //   // Emit the complete event with the saved message and structured data
            //   sessionStream.emit('data', {
            //     type: 'complete',
            //     result: structuredContent,
            //     message: sessionMessage
            //   })
            // } else {
            //   sessionStream.emit('data', {
            //     type: 'error',
            //     error: new Error('Failed to save session message to database')
            //   })
            // }
            sessionStream.emit('data', {
              type: 'complete',
              result: structuredContent
            })
            break
          }

          default:
            logger.warn('Unknown event type from Claude Code service:', {
              type: event.type
            })
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

  private deserializeSessionMessage(data: any): AgentSessionMessageEntity {
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
