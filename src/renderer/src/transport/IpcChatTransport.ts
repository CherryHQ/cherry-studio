import { loggerService } from '@logger'
import type { AiChatRequestBody } from '@shared/ai-transport'
import type { ChatRequestOptions, ChatTransport, UIMessage, UIMessageChunk } from 'ai'

const logger = loggerService.withContext('IpcChatTransport')

/**
 * ChatTransport implementation that bridges Renderer ↔ Main AI streaming via Electron IPC.
 *
 * Uses `window.api.ai` preload API to:
 * - Initiate stream requests (`streamText`)
 * - Receive chunks/done/error signals via global IPC listeners filtered by `requestId`
 * - Abort in-flight requests
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
    const { trigger, chatId, messageId, messages, abortSignal, body } = options
    const mergedBody = { ...this.#defaultBody, ...(body as Partial<AiChatRequestBody> | undefined) }
    const requestId = crypto.randomUUID()

    // Register IPC listeners before invoking streamText to avoid missing early chunks
    const unsubscribers: Array<() => void> = []
    let isCleaned = false

    const cleanup = () => {
      if (isCleaned) return
      isCleaned = true
      for (const unsub of unsubscribers) {
        unsub()
      }
    }

    let isStreamClosed = false

    const stream = new ReadableStream<UIMessageChunk>({
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

        // Chunk listener — filter by requestId since listeners are global
        unsubscribers.push(
          window.api.ai.onStreamChunk((data) => {
            if (data.requestId !== requestId || isStreamClosed) return
            controller.enqueue(data.chunk)
          })
        )

        // Done listener
        unsubscribers.push(
          window.api.ai.onStreamDone((data) => {
            if (data.requestId !== requestId) return
            closeStream()
          })
        )

        // Error listener
        unsubscribers.push(
          window.api.ai.onStreamError((data) => {
            if (data.requestId !== requestId) return
            errorStream(new Error(data.error.message ?? 'Unknown stream error'))
          })
        )

        // Abort handler — tell Main to stop and close the stream
        if (abortSignal) {
          if (abortSignal.aborted) {
            window.api.ai.abort(requestId)
            closeStream()
            return
          }

          const onAbort = () => {
            logger.info('Stream aborted', { requestId })
            window.api.ai.abort(requestId)
            closeStream()
          }
          abortSignal.addEventListener('abort', onAbort, { once: true })
          unsubscribers.push(() => abortSignal.removeEventListener('abort', onAbort))
        }

        // Fire the IPC request — stream chunks will arrive via listeners above
        window.api.ai
          .streamText({
            requestId,
            chatId,
            trigger,
            messageId,
            messages,
            ...mergedBody
          })
          .catch((error: unknown) => {
            const err = error instanceof Error ? error : new Error(String(error))
            logger.error('streamText IPC invoke failed', err)
            errorStream(err)
          })
      },
      cancel() {
        if (!isStreamClosed) {
          isStreamClosed = true
          window.api.ai.abort(requestId)
          cleanup()
        }
      }
    })

    return Promise.resolve(stream)
  }

  reconnectToStream(_options: { chatId: string } & ChatRequestOptions): Promise<ReadableStream<UIMessageChunk> | null> {
    // Electron IPC does not support stream reconnection
    return Promise.resolve(null)
  }
}
