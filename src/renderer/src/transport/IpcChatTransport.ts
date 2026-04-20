import { loggerService } from '@logger'
import type { AiChatRequestBody, StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ChatRequestOptions, ChatTransport, UIMessageChunk } from 'ai'

const logger = loggerService.withContext('IpcChatTransport')

/**
 * True when a stream event belongs to a single execution that finished but
 * the topic still has other executions streaming.
 *
 * Consumers that only care about topic-level completion (refreshing from DB,
 * closing the primary transport stream) should skip events matching this.
 */
export function isPerExecutionOnly(data: { executionId?: UniqueModelId; isTopicDone?: boolean }): boolean {
  return !!data.executionId && !data.isTopicDone
}

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
    const { chatId: topicId, messages, abortSignal, body, trigger } = options
    const mergedBody: Partial<AiChatRequestBody> = { ...this.#defaultBody, ...body }

    // Build listener stream before sending IPC to avoid missing early chunks
    const stream = this.buildListenerStream(topicId, undefined, abortSignal)

    const lastMessage = messages.at(-1)

    // Fire the IPC request — AiStreamManager handles dedup, persistence, routing
    window.api.ai
      .streamOpen({
        topicId,
        trigger,
        parentAnchorId: mergedBody.parentAnchorId || (trigger === 'regenerate-message' ? lastMessage?.id : undefined),
        userMessageParts: lastMessage ? lastMessage.parts : [],
        mentionedModelIds: mergedBody.mentionedModels,
        assistantMessageId: mergedBody.assistantMessageId
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
    logger.info('reconnectToStream called', { topicId })

    const result = await window.api.ai.streamAttach({ topicId })
    logger.info('reconnectToStream result', { topicId, status: result.status })

    if (result.status === 'not-found') return null
    if (result.status === 'done') {
      return new ReadableStream<UIMessageChunk>({ start: (c) => c.close() })
    }
    if (result.status === 'error') {
      return new ReadableStream<UIMessageChunk>({
        start: (c) => c.error(new Error(result.error.message ?? 'Stream error'))
      })
    }

    // status === 'attached' — buffered chunks returned in response, no IPC race
    logger.info('Reconnected to stream', { topicId, bufferedChunks: result.bufferedChunks.length })
    return this.buildListenerStream(topicId, result.bufferedChunks)
  }

  /**
   * Build a ReadableStream that receives chunks via IPC, filtered by topicId.
   *
   * All subscribers filter by topicId (not requestId) — streaming is just
   * one state of a topic, and all subscribers to the same topic are equal.
   */
  private buildListenerStream(
    topicId: string,
    initialChunks?: StreamChunkPayload[],
    abortSignal?: AbortSignal,
    executionId?: UniqueModelId
  ): ReadableStream<UIMessageChunk> {
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
        // Drain buffered chunks from attach response (no IPC race — chunks in response)
        if (initialChunks) {
          for (const data of initialChunks) {
            if (matchesStream(data)) controller.enqueue(data.chunk)
          }
        }

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

        function matchesStream(data: { topicId: string; executionId?: UniqueModelId; isTopicDone?: boolean }) {
          if (data.topicId !== topicId) return false
          if (executionId) return data.executionId === executionId || !!data.isTopicDone
          return !data.executionId || !!data.isTopicDone
        }

        unsubscribers.push(
          window.api.ai.onStreamChunk((data) => {
            if (data.topicId !== topicId || isStreamClosed) return
            if (executionId && data.executionId !== executionId) return // per-execution filter
            if (!executionId && data.executionId) return // primary stream: skip multi-model chunks
            if (isStreamClosed || !matchesStream(data)) return
            controller.enqueue(data.chunk)
          })
        )

        unsubscribers.push(
          window.api.ai.onStreamDone((data) => {
            if (!matchesStream(data)) return
            if (executionId && data.executionId !== executionId) return
            // Primary stream: close on topic-level done, skip per-execution done
            if (!executionId && isPerExecutionOnly(data)) return
            closeStream()
          })
        )

        unsubscribers.push(
          window.api.ai.onStreamError((data) => {
            if (!matchesStream(data)) return
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
  buildExecutionStream(topicId: string, executionId: UniqueModelId): ReadableStream<UIMessageChunk> {
    return this.buildListenerStream(topicId, undefined, undefined, executionId)
  }

  async reconnectExecutionStream(
    topicId: string,
    executionId: UniqueModelId
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const result = await window.api.ai.streamAttach({ topicId })

    if (result.status === 'not-found') return null
    if (result.status === 'done') {
      return new ReadableStream<UIMessageChunk>({ start: (c) => c.close() })
    }
    if (result.status === 'error') {
      return new ReadableStream<UIMessageChunk>({
        start: (c) => c.error(new Error(result.error.message ?? 'Stream error'))
      })
    }

    return this.buildListenerStream(topicId, result.bufferedChunks, undefined, executionId)
  }
}

/** Shared singleton — IpcChatTransport is stateless, safe to reuse everywhere. */
export const ipcChatTransport = new IpcChatTransport()

export class ExecutionTransport implements ChatTransport<CherryUIMessage> {
  constructor(
    private readonly topicId: string,
    private readonly executionId: UniqueModelId
  ) {}

  sendMessages(): Promise<ReadableStream<UIMessageChunk>> {
    return Promise.resolve(ipcChatTransport.buildExecutionStream(this.topicId, this.executionId))
  }

  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return ipcChatTransport.reconnectExecutionStream(this.topicId, this.executionId)
  }
}
