/**
 * SessionMessageOrchestrator
 *
 * Handles AI-subprocess stream orchestration for session messages.
 * This is intentionally NOT in data/services/ — it owns side effects
 * (spawning Claude Code, streaming LLM output) that violate the DataApi
 * "pure SQLite CRUD" boundary.
 *
 * Callers: apiServer message handler, SchedulerService, ChannelMessageHandler.
 */
import type { Options } from '@anthropic-ai/claude-agent-sdk'
import { sessionMessageService } from '@data/services/SessionMessageService'
import { loggerService } from '@logger'
import type { AgentStreamEvent } from '@main/services/agents/interfaces/AgentStreamInterface'
import ClaudeCodeService from '@main/services/agents/services/claudecode'
import type { AgentSessionMessageEntity, GetAgentSessionResponse } from '@types'
import type { TextStreamPart } from 'ai'

const logger = loggerService.withContext('SessionMessageOrchestrator')

export type CreateMessageOptions = {
  /** When true, persist user+assistant messages to DB on stream complete. */
  persist?: boolean
  /** Display-safe user content for persistence (overrides req.content). */
  displayContent?: string
  /** Images to persist in the user message for UI display. */
  images?: Array<{ data: string; media_type: string }>
}

export type SessionStreamResult = {
  stream: ReadableStream<TextStreamPart<Record<string, any>>>
  completion: Promise<{
    userMessage?: AgentSessionMessageEntity
    assistantMessage?: AgentSessionMessageEntity
  }>
}

type CreateSessionMessageRequest = {
  content: string
  effort?: Options['effort']
  thinking?: Options['thinking']
}

function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack }
  }
  if (typeof error === 'string') return { message: error }
  return { message: 'Unknown error' }
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
        if (part.text) this.textBuffer = part.text
        break
      case 'text-end': {
        const blockText = (part.providerMetadata?.text?.value as string | undefined) ?? this.textBuffer
        if (blockText) this.totalText += blockText
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

  getText(): string {
    return (this.totalText + this.textBuffer).replace(/\n+$/, '')
  }
}

export class SessionMessageOrchestrator {
  private cc: ClaudeCodeService = new ClaudeCodeService()

  async createSessionMessage(
    session: GetAgentSessionResponse,
    messageData: CreateSessionMessageRequest,
    abortController: AbortController,
    options?: CreateMessageOptions
  ): Promise<SessionStreamResult> {
    const agentSessionId = await sessionMessageService.getLastAgentSessionId(session.id)
    logger.debug('Session Message stream message data:', { message: messageData, session_id: agentSessionId })

    const claudeStream = await this.cc.invoke(
      messageData.content,
      session,
      abortController,
      agentSessionId,
      {
        effort: messageData.effort,
        thinking: messageData.thinking
      },
      undefined
    )
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
                if (options?.persist) {
                  const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
                  sessionMessageService
                    .persistHeadlessExchange(
                      session.id,
                      session.agentId,
                      session.model,
                      resolvedSessionId,
                      options?.displayContent ?? messageData.content,
                      accumulator.getText(),
                      options?.images
                    )
                    .then(resolveCompletion)
                    .catch((err) => {
                      logger.error('Failed to persist headless exchange', err as Error)
                      rejectCompletion(err)
                    })
                } else {
                  resolveCompletion({})
                }
                break
              }

              case 'cancelled': {
                cleanup()
                controller.close()
                if (options?.persist) {
                  const resolvedSessionId = claudeStream.sdkSessionId || agentSessionId
                  const partialText = accumulator.getText()
                  if (partialText) {
                    sessionMessageService
                      .persistHeadlessExchange(
                        session.id,
                        session.agentId,
                        session.model,
                        resolvedSessionId,
                        options?.displayContent ?? messageData.content,
                        partialText,
                        options?.images
                      )
                      .then(resolveCompletion)
                      .catch((err) => {
                        logger.error('Failed to persist cancelled exchange', err as Error)
                        rejectCompletion(err)
                      })
                  } else {
                    resolveCompletion({})
                  }
                } else {
                  resolveCompletion({})
                }
                break
              }

              default:
                logger.warn('Unknown event type from Claude Code service:', { type: event.type })
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
}

export const sessionMessageOrchestrator = new SessionMessageOrchestrator()
