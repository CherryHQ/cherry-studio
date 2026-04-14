import { loggerService } from '@logger'
import type { AiChatRequestBody } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { ChatRequestOptions, ChatTransport, UIMessageChunk } from 'ai'

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
export class IpcChatTransport implements ChatTransport<CherryUIMessage> {
  readonly #defaultBody: Partial<AiChatRequestBody>

  constructor(defaultBody: Partial<AiChatRequestBody> = {}) {
    this.#defaultBody = defaultBody
  }

  sendMessages(
    options: {
      trigger: 'submit-message' | 'regenerate-message'
      chatId: string
      messageId: string | undefined
      messages: CherryUIMessage[]
      abortSignal: AbortSignal | undefined
    } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { chatId: topicId, messages, abortSignal, body } = options
    const mergedBody: Partial<AiChatRequestBody> = { ...this.#defaultBody, ...body }

    // Build listener stream before sending IPC to avoid missing early chunks
    const stream = this.buildListenerStream(topicId, abortSignal)

    const lastMessage = messages.at(-1)

    // Fire the IPC request — AiStreamManager handles dedup, persistence, routing
    window.api.ai
      .streamOpen({
        topicId,
        parentAnchorId: mergedBody.parentAnchorId || undefined,
        userMessageParts: lastMessage ? lastMessage.parts : [],
        mentionedModels: mergedBody.mentionedModels
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

    // Register IPC listeners BEFORE the streamAttach round-trip.
    // Main replays buffered chunks synchronously during attach (addListener iterates
    // stream.buffer immediately). Those IPC messages are queued before the reply and
    // can arrive while we are suspended on the await below. Without pre-registration,
    // thinking blocks and other early chunks would be silently dropped.
    const earlyChunks: UIMessageChunk[] = []
    let earlyDone = false
    let earlyError: Error | null = null
    let liveController: ReadableStreamDefaultController<UIMessageChunk> | null = null
    let isCleaned = false

    const chunkUnsub = window.api.ai.onStreamChunk((data) => {
      if (data.topicId !== topicId) return
      if (liveController) liveController.enqueue(data.chunk)
      else earlyChunks.push(data.chunk)
    })
    const doneUnsub = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      earlyDone = true
      cleanup()
      liveController?.close()
    })
    const errorUnsub = window.api.ai.onStreamError((data) => {
      if (data.topicId !== topicId) return
      earlyError = new Error(data.error.message ?? 'Stream error')
      cleanup()
      liveController?.error(earlyError)
    })

    const cleanup = () => {
      if (isCleaned) return
      isCleaned = true
      chunkUnsub()
      doneUnsub()
      errorUnsub()
    }

    const result = await window.api.ai.streamAttach({ topicId })

    if (result.status === 'not-found') {
      cleanup()
      return null
    }
    if (result.status === 'done') {
      cleanup()
      // Stream already finished — history already loaded by V2ChatContent outer shell
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.close()
        }
      })
    }
    if (result.status === 'error') {
      cleanup()
      return new ReadableStream<UIMessageChunk>({
        start(controller) {
          controller.error(new Error((result.error as { message?: string })?.message ?? 'Stream error'))
        }
      })
    }

    // status === 'attached' — buffer replayed by Main; early chunks captured above
    logger.info('Reconnected to stream', { topicId, replayedChunks: result.replayedChunks })
    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        liveController = controller
        // Drain chunks that arrived during the IPC round-trip (replayed buffer)
        for (const chunk of earlyChunks) controller.enqueue(chunk)
        if (earlyDone) {
          controller.close()
          return
        }
        if (earlyError) {
          controller.error(earlyError)
        }
      },
      cancel() {
        cleanup()
        void window.api.ai.streamDetach({ topicId })
      }
    })
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
          // Component unmount / stream disposal: only detach this subscriber.
          // The stream itself keeps running in Main and will be persisted there.
          void window.api.ai.streamDetach({ topicId })
          cleanup()
        }
      }
    })
  }
}

/** Shared singleton — IpcChatTransport is stateless, safe to reuse everywhere. */
export const ipcChatTransport = new IpcChatTransport()
