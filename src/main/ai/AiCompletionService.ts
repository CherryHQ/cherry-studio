import { loggerService } from '@logger'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'

const logger = loggerService.withContext('AiCompletionService')

type ChatTrigger = Parameters<ChatTransport<UIMessage>['sendMessages']>[0]['trigger']

/**
 * Request payload for AI streaming.
 *
 * Sent from Renderer (via IPC) or Main (via Channel/Agent push).
 * Contains all context needed to execute an AI completion.
 */
export interface AiStreamRequest {
  /** Unique identifier for this request. Used for IPC chunk routing and abort. */
  requestId: string
  /** Conversation identifier. All requests in the same chat share this ID. Maps to `useChat({ id })`. */
  chatId: string
  /** Action type defined by AI SDK ChatTransport. */
  trigger: ChatTrigger
  /** ID of the message to regenerate (only for `regenerate-message` trigger). */
  messageId?: string
  /** Conversation history in AI SDK UIMessage format. */
  messages: UIMessage[]
  /** AI provider identifier (e.g. 'openai', 'anthropic'). */
  providerId?: string
  /** Model identifier (e.g. 'gpt-4o', 'claude-sonnet-4-20250514'). */
  modelId?: string
  /**
   * Assistant-level settings (temperature, topP, maxTokens, etc.).
   *
   * TODO (Step 2): Replace `Record<string, unknown>` with a concrete type
   * once BuildContext is designed. Source: renderer's AssistantSettings type,
   * which will be extracted to a shared schema during parameterBuilder migration.
   */
  assistantConfig?: Record<string, unknown>
  /**
   * Web search configuration (maxResults, excludeDomains, searchWithTime, etc.).
   *
   * TODO (Step 2): Replace `Record<string, unknown>` with a concrete type.
   * Source: renderer's Redux store (store.websearch).
   * Will be extracted to a shared schema during parameterBuilder migration.
   */
  websearchConfig?: Record<string, unknown>
  /** MCP tool IDs to enable for this request. */
  mcpToolIds?: string[]
  /** Knowledge base IDs for RAG retrieval. */
  knowledgeBaseIds?: string[]
}

/**
 * Unified AI completion service.
 *
 * Manages AI execution lifecycle: stream creation, abort handling, and request tracking.
 *
 * - Step 1 (current): Mock ReadableStream for IPC pipeline validation.
 * - Step 2: Integrate real aiCore (`createExecutor` + `streamText`).
 */
export class AiCompletionService {
  private activeRequests = new Map<string, AbortController>()

  /**
   * Execute an AI completion and return the result as a ReadableStream.
   *
   * Step 2 will replace the mock with:
   * `executor.streamText(params).toUIMessageStream()`
   *
   * @param request - The stream request containing messages, model config, etc.
   * @param signal - AbortSignal to cancel the stream mid-flight.
   * @returns ReadableStream of UIMessageChunk for consumption by AiService.
   */
  streamText(request: AiStreamRequest, signal: AbortSignal): ReadableStream<UIMessageChunk> {
    logger.info('streamText started', { requestId: request.requestId, chatId: request.chatId })

    // Step 1: mock ReadableStream
    const id = 'mock-part-0'
    const words = ['Hello', ' from', ' AiCompletionService', '!', ' Stream', ' is', ' working', '.']

    return new ReadableStream<UIMessageChunk>({
      async start(controller) {
        controller.enqueue({ type: 'text-start', id } as UIMessageChunk)

        for (const word of words) {
          if (signal.aborted) {
            logger.info('streamText aborted', { requestId: request.requestId })
            controller.close()
            return
          }
          controller.enqueue({ type: 'text-delta', delta: word, id } as UIMessageChunk)
          await new Promise((resolve) => setTimeout(resolve, 80))
        }

        controller.enqueue({ type: 'text-end', id } as UIMessageChunk)
        controller.close()
        logger.info('streamText completed', { requestId: request.requestId })
      }
    })
  }

  /** Track an active request for abort support. */
  registerRequest(requestId: string, controller: AbortController): void {
    this.activeRequests.set(requestId, controller)
  }

  /** Remove a completed/aborted request from tracking. */
  removeRequest(requestId: string): void {
    this.activeRequests.delete(requestId)
  }

  /** Abort an in-flight request by its requestId. No-op if not found. */
  abort(requestId: string): void {
    const controller = this.activeRequests.get(requestId)
    if (controller) {
      controller.abort()
      this.activeRequests.delete(requestId)
      logger.info('Request aborted', { requestId })
    }
  }
}
