import { EventEmitter } from 'node:events'

import { PermissionMode } from '@anthropic-ai/claude-code'
import { loggerService } from '@logger'
import type {
  AgentSessionMessageEntity,
  CreateSessionMessageRequest,
  GetAgentSessionResponse,
  ListOptions
} from '@types'
import { ModelMessage, UIMessage, UIMessageChunk } from 'ai'
import { convertToModelMessages, readUIMessageStream } from 'ai'
import { count, eq } from 'drizzle-orm'

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

// Utility function to normalize content to ModelMessage
function normalizeModelMessage(content: string | ModelMessage): ModelMessage {
  if (typeof content === 'string') {
    return {
      role: 'user',
      content: content
    }
  }
  return content
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

// Interface for persistence context
interface PersistContext {
  session: GetAgentSessionResponse
  accumulator: ChunkAccumulator
  userMessageId: number
}

// Chunk accumulator class to collect and reconstruct streaming data
class ChunkAccumulator {
  private streamedChunks: UIMessageChunk[] = []
  private rawAgentMessages: any[] = []
  private agentResult: any = null
  private agentType: string = 'unknown'
  private uniqueIds: Set<string> = new Set()

  addChunk(chunk: UIMessageChunk): void {
    this.streamedChunks.push(chunk)
  }

  addRawMessage(message: any): void {
    if (message.uuid && this.uniqueIds.has(message.uuid)) {
      // Duplicate message based on uuid; skip adding
      return
    }
    if (message.uuid) {
      this.uniqueIds.add(message.uuid)
    }
    this.rawAgentMessages.push(message)
  }

  setAgentResult(result: any): void {
    this.agentResult = result
    if (result?.agentType) {
      this.agentType = result.agentType
    }
  }

  buildStructuredContent() {
    return {
      aiSDKChunks: this.streamedChunks,
      rawAgentMessages: this.rawAgentMessages,
      agentResult: this.agentResult,
      agentType: this.agentType
    }
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

  getChunkCount(): number {
    return this.streamedChunks.length
  }

  getRawMessageCount(): number {
    return this.rawAgentMessages.length
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

  async saveUserMessage(sessionId: string, content: ModelMessage | string): Promise<AgentSessionMessageEntity> {
    this.ensureInitialized()

    const now = new Date().toISOString()
    const userContent: ModelMessage = normalizeModelMessage(content)

    const insertData: InsertSessionMessageRow = {
      session_id: sessionId,
      role: 'user',
      content: JSON.stringify(userContent),
      metadata: JSON.stringify({
        timestamp: now,
        source: 'api'
      }),
      created_at: now,
      updated_at: now
    }

    const [saved] = await this.database.insert(sessionMessagesTable).values(insertData).returning()

    return this.deserializeSessionMessage(saved) as AgentSessionMessageEntity
  }

  createSessionMessage(
    session: GetAgentSessionResponse,
    messageData: CreateSessionMessageRequest,
    userMessageId: number
  ): EventEmitter {
    this.ensureInitialized()

    // Create a new EventEmitter to manage the session message lifecycle
    const sessionStream = new EventEmitter()

    // No parent validation needed, start immediately
    this.startSessionMessageStream(session, messageData, sessionStream, userMessageId)

    return sessionStream
  }

  private startSessionMessageStream(
    session: GetAgentSessionResponse,
    req: CreateSessionMessageRequest,
    sessionStream: EventEmitter,
    userMessageId: number
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
      permissionMode: (session.configuration?.permissionMode as PermissionMode) || 'default',
      maxTurns: (session.configuration?.maxTurns as number) || 10
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
              accumulator.addChunk(chunk)

              // Collect raw agent message if available (agent-agnostic)
              if (event.rawAgentMessage) {
                accumulator.addRawMessage(event.rawAgentMessage)
              }

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
            const persistScheduled = accumulator.getChunkCount() > 0

            if (persistScheduled) {
              // Try to save partial state with error metadata when possible
              accumulator.setAgentResult({
                error: serializeError(underlyingError),
                agentType: 'claude-code',
                incomplete: true
              })

              void this.persistSessionMessageAsync({
                session,
                accumulator,
                userMessageId
              })
            }

            sessionStream.emit('data', {
              type: 'error',
              error: serializeError(underlyingError),
              persistScheduled
            })
            // Always emit a finish chunk at the end
            sessionStream.emit('data', {
              type: 'finish'
            })
            break
          }

          case 'complete': {
            // Extract additional raw agent messages from agentResult if available
            if (event.agentResult?.rawSDKMessages) {
              event.agentResult.rawSDKMessages.forEach((msg: any) => accumulator.addRawMessage(msg))
            }

            // Set the agent result in the accumulator
            accumulator.setAgentResult(event.agentResult)

            // Then handle async persistence
            void this.persistSessionMessageAsync({
              session,
              accumulator,
              userMessageId
            })
            // Always emit a finish chunk at the end
            sessionStream.emit('data', {
              type: 'finish'
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
          error: serializeError(error)
        })
      }
    })
  }

  private async persistSessionMessageAsync({ session, accumulator, userMessageId }: PersistContext) {
    if (!session?.id) {
      const missingSessionError = new Error('Missing session_id for persisted message')
      logger.error('error persisting session message', { error: missingSessionError })
      return
    }

    const sessionId = session.id
    const now = new Date().toISOString()
    const structured = accumulator.buildStructuredContent()

    try {
      // Use chunksToModelMessages to convert chunks to ModelMessages
      const modelMessages = await accumulator.toModelMessages()
      // Get the last message (should be the assistant's response)
      const modelMessage =
        modelMessages.length > 0 ? modelMessages[modelMessages.length - 1] : accumulator.toModelMessage('assistant')

      const metadata = {
        userMessageId,
        chunkCount: accumulator.getChunkCount(),
        rawMessageCount: accumulator.getRawMessageCount(),
        agentType: accumulator.getAgentType(),
        completedAt: now
      }

      const insertData: InsertSessionMessageRow = {
        session_id: sessionId,
        role: 'assistant',
        content: JSON.stringify({ modelMessage, ...structured }),
        metadata: JSON.stringify(metadata),
        created_at: now,
        updated_at: now
      }

      await this.database.insert(sessionMessagesTable).values(insertData).returning()
      logger.debug('Success Persisted session message')
    } catch (error) {
      logger.error('Failed to persist session message', { error })
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
