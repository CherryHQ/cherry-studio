import { EventEmitter } from 'node:events'

import { loggerService } from '@logger'
import type {
  AgentSessionMessageEntity,
  CreateSessionMessageRequest,
  GetAgentSessionResponse,
  ListOptions
} from '@types'
import { ModelMessage, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages, readUIMessageStream } from 'ai'
import { desc, eq } from 'drizzle-orm'

import { BaseService } from '../BaseService'
import { InsertSessionMessageRow, sessionMessagesTable } from '../database/schema'
import ClaudeCodeService from './claudecode'

const logger = loggerService.withContext('SessionMessageService')

// Collapse a UIMessageChunk stream into a final UIMessage, then convert to ModelMessage[]
export async function chunksToModelMessages(
  chunkStream: ReadableStream<UIMessageChunk>,
  priorUiHistory: UIMessage[] = []
): Promise<ModelMessage[]> {
  let latest: UIMessage | undefined

  for await (const uiMsg of readUIMessageStream({ stream: chunkStream })) {
    latest = uiMsg // each yield is a newer state; keep the last one
  }

  const uiMessages = latest ? [...priorUiHistory, latest] : priorUiHistory
  return convertToModelMessages(uiMessages) // -> ModelMessage[]
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

// Chunk accumulator class to collect and reconstruct streaming data
class ChunkAccumulator {
  private streamedChunks: UIMessageChunk[] = []
  private agentType: string = 'unknown'

  addChunk(chunk: UIMessageChunk): void {
    this.streamedChunks.push(chunk)
  }

  // Create a ReadableStream from accumulated chunks
  createChunkStream(): ReadableStream<UIMessageChunk> {
    const chunks = [...this.streamedChunks]

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        // Enqueue all chunks
        for (const chunk of chunks) {
          controller.enqueue(chunk)
        }
        controller.close()
      }
    })
  }

  // Convert accumulated chunks to ModelMessages using chunksToModelMessages
  async toModelMessages(priorUiHistory: UIMessage[] = []): Promise<ModelMessage[]> {
    const chunkStream = this.createChunkStream()
    return await chunksToModelMessages(chunkStream, priorUiHistory)
  }

  toModelMessage(role: ModelMessage['role'] = 'assistant'): ModelMessage {
    // Reconstruct the content from chunks
    let textContent = ''
    const toolCalls: any[] = []

    for (const chunk of this.streamedChunks) {
      if (chunk.type === 'text-delta' && 'delta' in chunk) {
        textContent += chunk.delta
      } else if (chunk.type === 'tool-input-available' && 'toolCallId' in chunk && 'toolName' in chunk) {
        // Handle tool calls - use tool-input-available chunks
        const toolCall = {
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          args: chunk.input || {}
        }
        toolCalls.push(toolCall)
      }
    }

    const message: any = {
      role,
      content: textContent
    }

    // Add tool invocations if any
    if (toolCalls.length > 0) {
      message.toolInvocations = toolCalls
    }

    return message as ModelMessage
  }

  getAgentType(): string {
    return this.agentType
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

  createSessionMessage(session: GetAgentSessionResponse, messageData: CreateSessionMessageRequest): EventEmitter {
    this.ensureInitialized()

    // Create a new EventEmitter to manage the session message lifecycle
    const sessionStream = new EventEmitter()

    // No parent validation needed, start immediately
    this.startSessionMessageStream(session, messageData, sessionStream)

    return sessionStream
  }

  private async startSessionMessageStream(
    session: GetAgentSessionResponse,
    req: CreateSessionMessageRequest,
    sessionStream: EventEmitter
  ): Promise<void> {
    const agentSessionId = await this.getLastAgentSessionId(session.id)
    let newAgentSessionId = ''
    logger.debug('Session Message stream message data:', { message: req, session_id: agentSessionId })

    if (session.agent_type !== 'claude-code') {
      // TODO: Implement support for other agent types
      logger.error('Unsupported agent type for streaming:', { agent_type: session.agent_type })
      throw new Error('Unsupported agent type for streaming')
    }

    // Create the streaming agent invocation (using invokeStream for streaming)
    const claudeStream = this.cc.invoke(req.content, session.accessible_paths[0], agentSessionId, {
      permissionMode: session.configuration?.permission_mode,
      maxTurns: session.configuration?.max_turns
    })

    // Use chunk accumulator to manage streaming data
    const accumulator = new ChunkAccumulator()

    // Handle agent stream events (agent-agnostic)
    claudeStream.on('data', async (event: any) => {
      try {
        switch (event.type) {
          case 'chunk':
            // Forward UIMessageChunk directly and collect raw agent messages
            if (event.chunk) {
              const chunk = event.chunk as UIMessageChunk
              if (chunk.type === 'start' && chunk.messageId) {
                newAgentSessionId = chunk.messageId
              }
              accumulator.addChunk(chunk)

              sessionStream.emit('data', {
                type: 'chunk',
                chunk
              })
            } else {
              logger.warn('Received agent chunk event without chunk payload')
            }
            break

          case 'error': {
            const underlyingError = event.error || (event.data?.stderr ? new Error(event.data.stderr) : undefined)

            sessionStream.emit('data', {
              type: 'error',
              error: serializeError(underlyingError),
              persistScheduled: false
            })
            // Always emit a finish chunk at the end
            sessionStream.emit('data', {
              type: 'finish',
              persistScheduled: false
            })
            break
          }

          case 'complete': {
            const completionPayload = event.result ?? accumulator.toModelMessage('assistant')

            sessionStream.emit('data', {
              type: 'complete',
              result: completionPayload
            })

            try {
              const persisted = await this.database.transaction(async (tx) => {
                const userMessage = await this.persistUserMessage(tx, session.id, req.content, newAgentSessionId)
                const assistantMessage = await this.persistAssistantMessage({
                  tx,
                  session,
                  accumulator,
                  agentSessionId: newAgentSessionId
                })

                return { userMessage, assistantMessage }
              })

              sessionStream.emit('data', {
                type: 'persisted',
                message: persisted.assistantMessage,
                userMessage: persisted.userMessage
              })
            } catch (persistError) {
              sessionStream.emit('data', {
                type: 'persist-error',
                error: serializeError(persistError)
              })
            } finally {
              // Always emit a finish chunk at the end
              sessionStream.emit('data', {
                type: 'finish',
                persistScheduled: true
              })
            }
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
          error: serializeError(error)
        })
      }
    })
  }

  private async getLastAgentSessionId(sessionId: string): Promise<string> {
    this.ensureInitialized()

    try {
      const result = await this.database
        .select({ agent_session_id: sessionMessagesTable.agent_session_id })
        .from(sessionMessagesTable)
        .where(eq(sessionMessagesTable.session_id, sessionId))
        .orderBy(desc(sessionMessagesTable.created_at))
        .limit(1)

      return result[0]?.agent_session_id || ''
    } catch (error) {
      logger.error('Failed to get last agent session ID', {
        sessionId,
        error
      })
      return ''
    }
  }

  async persistUserMessage(
    tx: any,
    sessionId: string,
    prompt: string,
    agentSessionId: string
  ): Promise<AgentSessionMessageEntity> {
    this.ensureInitialized()

    const now = new Date().toISOString()
    const insertData: InsertSessionMessageRow = {
      session_id: sessionId,
      role: 'user',
      content: JSON.stringify({ role: 'user', content: prompt }),
      agent_session_id: agentSessionId,
      created_at: now,
      updated_at: now
    }

    const [saved] = await tx.insert(sessionMessagesTable).values(insertData).returning()

    return this.deserializeSessionMessage(saved) as AgentSessionMessageEntity
  }

  private async persistAssistantMessage({
    tx,
    session,
    accumulator,
    agentSessionId
  }: {
    tx: any
    session: GetAgentSessionResponse
    accumulator: ChunkAccumulator
    agentSessionId: string
  }): Promise<AgentSessionMessageEntity> {
    if (!session?.id) {
      const missingSessionError = new Error('Missing session_id for persisted message')
      logger.error('error persisting session message', { error: missingSessionError })
      throw missingSessionError
    }

    const sessionId = session.id
    const now = new Date().toISOString()

    try {
      // Use chunksToModelMessages to convert chunks to ModelMessages
      const modelMessages = await accumulator.toModelMessages()
      // Get the last message (should be the assistant's response)
      const modelMessage =
        modelMessages.length > 0 ? modelMessages[modelMessages.length - 1] : accumulator.toModelMessage('assistant')

      const insertData: InsertSessionMessageRow = {
        session_id: sessionId,
        role: 'assistant',
        content: JSON.stringify(modelMessage),
        agent_session_id: agentSessionId,
        created_at: now,
        updated_at: now
      }

      const [saved] = await tx.insert(sessionMessagesTable).values(insertData).returning()
      logger.debug('Success Persisted session message')

      return this.deserializeSessionMessage(saved) as AgentSessionMessageEntity
    } catch (error) {
      logger.error('Failed to persist session message', { error })
      throw error
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
