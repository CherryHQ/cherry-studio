import { loggerService } from '@logger'
import { type AiChatRequestBody, type AiStreamOpenRequest, type StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ChatRequestOptions, ChatTransport, UIMessageChunk } from 'ai'

import { streamDispatchCoordinator } from './streamDispatchCoordinator'

const logger = loggerService.withContext('IpcChatTransport')

/** Single execution terminated while other executions on the topic are still streaming. */
export function isPerExecutionOnly(data: { executionId?: UniqueModelId; isTopicDone?: boolean }): boolean {
  return !!data.executionId && !data.isTopicDone
}

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

    const stream = this.buildListenerStream(topicId, undefined, abortSignal)

    const lastMessage = messages.at(-1)
    const ipcRequest: AiStreamOpenRequest =
      trigger === 'regenerate-message'
        ? {
            trigger: 'regenerate-message',
            topicId,
            parentAnchorId: mergedBody.parentAnchorId ?? '',
            mentionedModelIds: mergedBody.mentionedModels
          }
        : {
            trigger: 'submit-message',
            topicId,
            parentAnchorId: mergedBody.parentAnchorId,
            userMessageParts: lastMessage?.parts ?? [],
            mentionedModelIds: mergedBody.mentionedModels
          }

    streamDispatchCoordinator.dispatch(topicId, ipcRequest)

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
    if (result.status === 'done' || result.status === 'paused') {
      return new ReadableStream<UIMessageChunk>({ start: (c) => c.close() })
    }
    if (result.status === 'error') {
      return new ReadableStream<UIMessageChunk>({
        start: (c) => c.error(new Error(result.error?.message ?? 'Stream error'))
      })
    }

    logger.info('Reconnected to stream', { topicId, bufferedChunks: result.bufferedChunks.length })
    return this.buildListenerStream(topicId, result.bufferedChunks)
  }

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
        if (initialChunks) {
          for (const data of initialChunks) {
            if (matchesStream(data)) controller.enqueue(data.chunk)
          }
        }

        let pendingChunks: UIMessageChunk[] = []
        let rafHandle: number | null = null
        const flushPending = () => {
          rafHandle = null
          if (pendingChunks.length === 0 || isStreamClosed) {
            pendingChunks = []
            return
          }
          const batch = pendingChunks
          pendingChunks = []
          for (const chunk of batch) controller.enqueue(chunk)
        }
        const schedulePending = (chunk: UIMessageChunk) => {
          pendingChunks.push(chunk)
          if (rafHandle === null) rafHandle = requestAnimationFrame(flushPending)
        }
        const cancelPending = () => {
          if (rafHandle !== null) {
            cancelAnimationFrame(rafHandle)
            rafHandle = null
          }
          pendingChunks = []
        }
        unsubscribers.push(cancelPending)

        const closeStream = () => {
          if (isStreamClosed) return
          isStreamClosed = true
          // Drain pending RAF batch before close so the last few text-deltas
          // aren't dropped between schedule and `done`.
          if (rafHandle !== null) cancelAnimationFrame(rafHandle)
          rafHandle = null
          for (const chunk of pendingChunks) controller.enqueue(chunk)
          pendingChunks = []
          cleanup()
          controller.close()
        }

        const errorStream = (err: Error) => {
          if (isStreamClosed) return
          isStreamClosed = true
          cancelPending()
          cleanup()
          controller.error(err)
        }

        function matchesStream(data: { topicId: string; executionId?: UniqueModelId; isTopicDone?: boolean }) {
          if (data.topicId !== topicId) return false
          if (executionId) return data.executionId === executionId || !!data.isTopicDone
          return !data.executionId || !!data.isTopicDone
        }

        unsubscribers.push(
          streamDispatchCoordinator.subscribe(topicId, (result) => {
            if (result.ok) {
              if (result.ack.mode === 'blocked') closeStream()
              return
            }
            errorStream(result.error)
          }),
          window.api.ai.onStreamChunk((data) => {
            if (data.topicId !== topicId || isStreamClosed) return
            if (executionId && data.executionId !== executionId) return
            if (!executionId && data.executionId) return
            if (isStreamClosed || !matchesStream(data)) return
            schedulePending(data.chunk)
          })
        )

        unsubscribers.push(
          window.api.ai.onStreamDone((data) => {
            if (!matchesStream(data)) return
            if (executionId && data.executionId !== executionId) return
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

        if (abortSignal) {
          if (abortSignal.aborted) {
            window.api.ai.streamAbort({ topicId }).catch((e) => logger.warn('streamAbort failed', { topicId, e }))
            closeStream()
            return
          }

          const onAbort = () => {
            logger.info('Stream abort requested', { topicId })
            window.api.ai.streamAbort({ topicId }).catch((e) => logger.warn('streamAbort failed', { topicId, e }))
            closeStream()
          }
          abortSignal.addEventListener('abort', onAbort, { once: true })
          unsubscribers.push(() => abortSignal.removeEventListener('abort', onAbort))
        }
      },
      cancel() {
        if (!isStreamClosed) {
          isStreamClosed = true
          // Unmount / disposal: only detach this subscriber. Main keeps
          // generating and persists the result; abort is a separate IPC.
          window.api.ai.streamDetach({ topicId }).catch((e) => logger.warn('streamDetach failed', { topicId, e }))
          cleanup()
        }
      }
    })
  }
}

export const ipcChatTransport = new IpcChatTransport()
