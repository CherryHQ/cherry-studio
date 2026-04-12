import { loggerService } from '@logger'
import type { AiChatRequestBody } from '@shared/ai/transport'
import type { ChatRequestOptions, ChatTransport, UIMessage, UIMessageChunk } from 'ai'

const logger = loggerService.withContext('IpcChatTransport')

/**
 * ChatTransport implementation that bridges Renderer ↔ Main AI streaming via Electron IPC.
 *
 * Uses `window.api.ai` preload API:
 * - `streamOpen` to initiate a stream (AiStreamManager routes to start or steer)
 * - `streamAttach` to reconnect to a running or recently-finished stream
 * - `streamAbort` to stop generation
 * - Chunk/done/error listeners filtered by `topicId`
 */
export class IpcChatTransport implements ChatTransport<UIMessage> {
  readonly #defaultBody: Partial<AiChatRequestBody>

  constructor(defaultBody: Partial<AiChatRequestBody> = {}) {
    this.#defaultBody = defaultBody
  }

  sendMessages(
    options: {
      trigger: 'submit-message' | 'regenerate-message'
      chatId: string
      messageId: string | undefined
      messages: UIMessage[]
      abortSignal: AbortSignal | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { chatId: topicId, messages, abortSignal, body } = options
    const mergedBody = { ...this.#defaultBody, ...(body as Partial<AiChatRequestBody> | undefined) }

    // Build listener stream before sending IPC to avoid missing early chunks
    const stream = this.buildListenerStream(topicId, abortSignal)

    const lastMessage = messages.at(-1)
    const userMessage = lastMessage
      ? { role: 'user' as const, data: { parts: lastMessage.parts ?? [] } }
      : { role: 'user' as const, data: { parts: [] as UIMessage['parts'] } }

    // Fire the IPC request — AiStreamManager handles dedup, persistence, routing
    window.api.ai
      .streamOpen({
        topicId,
        parentAnchorId: (mergedBody as Record<string, unknown>).parentAnchorId as string | null,
        userMessage,
        assistantId: (mergedBody as Record<string, unknown>).assistantId as string,
        ...mergedBody
      })
      .catch((error: unknown) => {
        logger.error('streamOpen IPC failed', error instanceof Error ? error : new Error(String(error)))
      })

    return Promise.resolve(stream)
  }

  async reconnectToStream(
    options: { chatId: string } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const topicId = options.chatId

    const result = await window.api.ai.streamAttach({ topicId })
    if (result.status === 'not-found') return null
    if (result.status === 'done') {
      // Stream already finished — return a stream that immediately closes
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close()
        }
      })
    }
    if (result.status === 'error') {
      return new ReadableStream<UIMessageChunk>({
        start(controller_1) {
          controller_1.error(new Error((result.error as { message?: string })?.message ?? 'Stream error'))
        }
      })
    }
    // status === 'attached' — buffer already replayed by Main, live chunks incoming
    logger.info('Reconnected to stream', { topicId, replayedChunks: result.replayedChunks })
    return this.buildListenerStream(topicId)
  }

  /**
   * Build a ReadableStream that receives chunks via IPC, filtered by topicId.
   *
   * All subscribers filter by topicId (not requestId) — streaming is just
   * one state of a topic, and all subscribers to the same topic are equal.
   */
  private buildListenerStream(topicId: string, abortSignal?: AbortSignal): ReadableStream<UIMessageChunk> {
    const unsubscribers: Array<() => void> = []
    let isCleaned = false
    let isStreamClosed = false

    const cleanup = () => {
      if (isCleaned) return
      isCleaned = true
      for (const unsub of unsubscribers) unsub()
    }

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        const closeStream = () => {
          if (isStreamClosed) return
          isStreamClosed = true
          cleanup()
          controller.close()
        }

        const errorStream = (err: Error) => {
          if (isStreamClosed) return
          isStreamClosed = true
          cleanup()
          controller.error(err)
        }

        unsubscribers.push(
          window.api.ai.onStreamChunk((data) => {
            if (data.topicId !== topicId || isStreamClosed) return
            controller.enqueue(data.chunk)
          })
        )

        unsubscribers.push(
          window.api.ai.onStreamDone((data) => {
            if (data.topicId !== topicId) return
            closeStream()
          })
        )

        unsubscribers.push(
          window.api.ai.onStreamError((data) => {
            if (data.topicId !== topicId) return
            errorStream(new Error(data.error.message ?? 'Unknown stream error'))
          })
        )

        // Abort: stop the generation on Main
        if (abortSignal) {
          if (abortSignal.aborted) {
            void window.api.ai.streamAbort({ topicId })
            closeStream()
            return
          }

          const onAbort = () => {
            logger.info('Stream abort requested', { topicId })
            void window.api.ai.streamAbort({ topicId })
            closeStream()
          }
          abortSignal.addEventListener('abort', onAbort, { once: true })
          unsubscribers.push(() => abortSignal.removeEventListener('abort', onAbort))
        }
      },
      cancel() {
        if (!isStreamClosed) {
          isStreamClosed = true
          // Component unmount: abort the stream so Main can persist partial result
          void window.api.ai.streamAbort({ topicId })
          cleanup()
        }
      }
    })
  }
}
