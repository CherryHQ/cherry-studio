import { loggerService } from '@logger'
import type {
  AgentSessionMessageEntity,
  CreateSessionMessageRequest,
  GetAgentSessionResponse,
  ListOptions
} from '@types'
import type { TextStreamPart } from 'ai'
import { and, desc, eq, not } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { sessionMessagesTable } from '../database/schema'
import type { AgentStreamEvent } from '../interfaces/AgentStreamInterface'
import ClaudeCodeService from './claudecode'

const logger = loggerService.withContext('SessionMessageService')

type SessionStreamResult = {
  stream: ReadableStream<TextStreamPart<Record<string, any>>>
  completion: Promise<{
    userMessage?: AgentSessionMessageEntity
    assistantMessage?: AgentSessionMessageEntity
  }>
}

// Ensure errors emitted through SSE are serializable
function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack
    }
  }

  if (typeof error === 'string') {
    return { message: error }
  }

  return {
    message: 'Unknown error'
  }
}

class TextStreamAccumulator {
  private textBuffer = ''
  private totalText = ''
  private readonly toolCalls = new Map<string, { toolName?: string; input?: unknown }>()
  private readonly toolResults = new Map<string, unknown>()

  add(part: TextStreamPart<Record<string, any>>): void {
    switch (part.type) {
      case 'text-start':
        this.textBuffer = ''
        break
      case 'text-delta':
        if (part.text) {
          this.textBuffer += part.text
        }
        break
      case 'text-end': {
        const blockText = (part.providerMetadata?.text?.value as string | undefined) ?? this.textBuffer
        if (blockText) {
          this.totalText += blockText
        }
        this.textBuffer = ''
        break
      }
      case 'tool-call':
        if (part.toolCallId) {
          const legacyPart = part as typeof part & {
            args?: unknown
            providerMetadata?: { raw?: { input?: unknown } }
          }
          this.toolCalls.set(part.toolCallId, {
            toolName: part.toolName,
            input: part.input ?? legacyPart.args ?? legacyPart.providerMetadata?.raw?.input
          })
        }
        break
      case 'tool-result':
        if (part.toolCallId) {
          const legacyPart = part as typeof part & {
            result?: unknown
            providerMetadata?: { raw?: unknown }
          }
          this.toolResults.set(part.toolCallId, part.output ?? legacyPart.result ?? legacyPart.providerMetadata?.raw)
        }
        break
      default:
        break
    }
  }
}

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
  ): Promise<{ messages: AgentSessionMessageEntity[] }> {
    this.ensureInitialized()

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

    return { messages }
  }

  async deleteSessionMessage(sessionId: string, messageId: number): Promise<boolean> {
    this.ensureInitialized()

    const result = this.database
      .delete(sessionMessagesTable)
      .where(and(eq(sessionMessagesTable.id, messageId), eq(sessionMessagesTable.session_id, sessionId)))
      .run()

    return result.changes > 0
  }

  async createSessionMessage(
    session: GetAgentSessionResponse,
    messageData: CreateSessionMessageRequest,
    abortController: AbortController
  ): Promise<SessionStreamResult> {
    this.ensureInitialized()

    return await this.startSessionMessageStream(session, messageData, abortController)
  }

  private async startSessionMessageStream(
    session: GetAgentSessionResponse,
    req: CreateSessionMessageRequest,
    abortController: AbortController
  ): Promise<SessionStreamResult> {
    const agentSessionId = await this.getLastAgentSessionId(session.id)
    logger.debug('Session Message stream message data:', { message: req, session_id: agentSessionId })

    if (session.agent_type !== 'claude-code') {
      // TODO: Implement support for other agent types
      logger.error('Unsupported agent type for streaming:', { agent_type: session.agent_type })
      throw new Error('Unsupported agent type for streaming')
    }

    const claudeStream = await this.cc.invoke(req.content, session, abortController, agentSessionId)
    const accumulator = new TextStreamAccumulator()

    let resolveCompletion!: (value: {
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }) => void
    let rejectCompletion!: (reason?: unknown) => void

    const completion = new Promise<{
      userMessage?: AgentSessionMessageEntity
      assistantMessage?: AgentSessionMessageEntity
    }>((resolve, reject) => {
      resolveCompletion = resolve
      rejectCompletion = reject
    })

    let finished = false

    const cleanup = () => {
      if (finished) return
      finished = true
      claudeStream.removeAllListeners()
    }

    const stream = new ReadableStream<TextStreamPart<Record<string, any>>>({
      start: (controller) => {
        claudeStream.on('data', async (event: AgentStreamEvent) => {
          if (finished) return
          try {
            switch (event.type) {
              case 'chunk': {
                const chunk = event.chunk as TextStreamPart<Record<string, any>> | undefined
                if (!chunk) {
                  logger.warn('Received agent chunk event without chunk payload')
                  return
                }

                accumulator.add(chunk)
                controller.enqueue(chunk)
                break
              }

              case 'error': {
                const stderrMessage = (event as any)?.data?.stderr as string | undefined
                const underlyingError = event.error ?? (stderrMessage ? new Error(stderrMessage) : undefined)
                cleanup()
                const streamError = underlyingError ?? new Error('Stream error')
                controller.error(streamError)
                rejectCompletion(serializeError(streamError))
                break
              }

              case 'complete': {
                cleanup()
                controller.close()
                resolveCompletion({})
                break
              }

              case 'cancelled': {
                cleanup()
                controller.close()
                resolveCompletion({})
                break
              }

              default:
                logger.warn('Unknown event type from Claude Code service:', {
                  type: event.type
                })
                break
            }
          } catch (error) {
            cleanup()
            controller.error(error)
            rejectCompletion(serializeError(error))
          }
        })
      },
      cancel: (reason) => {
        cleanup()
        abortController.abort(typeof reason === 'string' ? reason : 'stream cancelled')
        resolveCompletion({})
      }
    })

    return { stream, completion }
  }

  private async getLastAgentSessionId(sessionId: string): Promise<string> {
    this.ensureInitialized()

    try {
      const result = await this.database
        .select({ agent_session_id: sessionMessagesTable.agent_session_id })
        .from(sessionMessagesTable)
        .where(and(eq(sessionMessagesTable.session_id, sessionId), not(eq(sessionMessagesTable.agent_session_id, ''))))
        .orderBy(desc(sessionMessagesTable.created_at))
        .limit(1)

      logger.silly('Last agent session ID result:', { agentSessionId: result[0]?.agent_session_id, sessionId })
      return result[0]?.agent_session_id || ''
    } catch (error) {
      logger.error('Failed to get last agent session ID', {
        sessionId,
        error
      })
      return ''
    }
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
