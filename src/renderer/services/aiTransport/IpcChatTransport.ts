import type { ChatRequestOptions, ChatTransport, UIMessageChunk } from 'ai'

import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  type AiChatRequestBody,
  type AiStreamOpenRequest,
  type StreamChunkPayload,
  type StreamDonePayload,
  type StreamErrorPayload
} from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'

import { capAttachReplayChunks, dropCoveredOverflow, MAX_ATTACH_REPLAY_CHUNKS } from './capAttachReplay'
import { streamDispatchService } from './StreamDispatchService'

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
            mentionedModelIds: mergedBody.mentionedModels,
            reasoningEffort: mergedBody.reasoningEffort,
            ...(mergedBody.fastMode ? { fastMode: true } : {})
          }
        : {
            trigger: 'submit-message',
            topicId,
            parentAnchorId: mergedBody.parentAnchorId,
            userMessageParts: mergedBody.userMessageParts ?? lastMessage?.parts ?? [],
            mentionedModelIds: mergedBody.mentionedModels,
            reasoningEffort: mergedBody.reasoningEffort,
            ...(mergedBody.fastMode ? { fastMode: true } : {})
          }

    streamDispatchService.dispatch(topicId, ipcRequest)

    return Promise.resolve(stream)
  }

  async reconnectToStream(
    options: { chatId: string } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const topicId = options.chatId
    logger.info('reconnectToStream called', { topicId })

    // Subscribe BEFORE attaching: main registers our sender the moment it
    // processes the attach, and live chunks broadcast before our stream
    // listeners exist would otherwise be lost. Overflow drains after replay.
    const overflowChunks: StreamChunkPayload[] = []
    let overflowDone: StreamDonePayload | undefined
    let overflowError: StreamErrorPayload | undefined
    const overflowUnsubs = [
      ipcApi.on('ai.stream.chunk', (data) => {
        if (data.topicId === topicId) overflowChunks.push(data)
      }),
      ipcApi.on('ai.stream.done', (data) => {
        if (data.topicId === topicId) overflowDone = data
      }),
      ipcApi.on('ai.stream.error', (data) => {
        if (data.topicId === topicId) overflowError = data
      })
    ]
    const result = await ipcApi.request('ai.stream.attach', { topicId }).finally(() => {
      for (const unsub of overflowUnsubs) unsub()
    })
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
    let replayChunks = result.bufferedChunks
    let droppedSeqs: readonly number[] = []
    if (result.bufferedChunks.length > MAX_ATTACH_REPLAY_CHUNKS) {
      logger.warn('transport replay capped', {
        total: result.bufferedChunks.length,
        topicId,
        overflowChunks: overflowChunks.length
      })
      const capped = capAttachReplayChunks(result.bufferedChunks, MAX_ATTACH_REPLAY_CHUNKS)
      replayChunks = capped.replay
      droppedSeqs = capped.droppedSeqs
    }
    // Main also sent pre-attach live chunks to a stale/parallel listener for
    // this window; those are inside the snapshot above, so drain only the rest.
    const freshOverflow = dropCoveredOverflow(replayChunks, overflowChunks, droppedSeqs)
    return this.buildListenerStream(topicId, [...replayChunks, ...freshOverflow], undefined, undefined, {
      done: overflowDone,
      error: overflowError
    })
  }

  private buildListenerStream(
    topicId: string,
    initialChunks?: StreamChunkPayload[],
    abortSignal?: AbortSignal,
    executionId?: UniqueModelId,
    initialTerminal?: { done?: StreamDonePayload; error?: StreamErrorPayload }
  ): ReadableStream<UIMessageChunk> {
    const unsubscribers: Array<() => void> = []
    let isCleaned = false
    let isStreamClosed = false
    let pinnedExecutionId: UniqueModelId | undefined

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
          if (data.isTopicDone) return true
          if (!data.executionId) return true
          if (pinnedExecutionId === undefined) {
            pinnedExecutionId = data.executionId
            return true
          }
          return data.executionId === pinnedExecutionId
        }

        unsubscribers.push(
          streamDispatchService.subscribe(topicId, (result) => {
            if (result.ok) {
              if (result.ack.mode === 'blocked') closeStream()
              return
            }
            errorStream(result.error)
          }),
          ipcApi.on('ai.stream.chunk', (data) => {
            if (data.topicId !== topicId || isStreamClosed) return
            if (executionId && data.executionId !== executionId) return
            if (isStreamClosed || !matchesStream(data)) return
            schedulePending(data.chunk)
          })
        )

        unsubscribers.push(
          ipcApi.on('ai.stream.done', (data) => {
            if (!matchesStream(data)) return
            if (executionId && data.executionId !== executionId) return
            if (!executionId && isPerExecutionOnly(data)) return
            closeStream()
          })
        )

        unsubscribers.push(
          ipcApi.on('ai.stream.error', (data) => {
            if (!matchesStream(data)) return
            if (executionId && data.executionId !== executionId) return
            if (!executionId && isPerExecutionOnly(data)) return
            errorStream(new Error(data.error.message ?? 'Unknown stream error'))
          })
        )

        if (abortSignal) {
          if (abortSignal.aborted) {
            ipcApi
              .request('ai.stream.abort', { topicId })
              .catch((e) => logger.warn('streamAbort failed', { topicId, e }))
            closeStream()
            return
          }

          const onAbort = () => {
            logger.info('Stream abort requested', { topicId })
            ipcApi
              .request('ai.stream.abort', { topicId })
              .catch((e) => logger.warn('streamAbort failed', { topicId, e }))
            closeStream()
          }
          abortSignal.addEventListener('abort', onAbort, { once: true })
          unsubscribers.push(() => abortSignal.removeEventListener('abort', onAbort))
        }

        // Terminal events that arrived during the attach round-trip use the
        // same filters as their live handlers so the stream still settles.
        if (initialTerminal?.error) {
          const data = initialTerminal.error
          if (
            matchesStream(data) &&
            !(executionId && data.executionId !== executionId) &&
            (executionId || !isPerExecutionOnly(data))
          ) {
            errorStream(new Error(data.error.message ?? 'Unknown stream error'))
          }
        }
        // A filtered per-execution error must not suppress a later topic done.
        if (!isStreamClosed && initialTerminal?.done) {
          const data = initialTerminal.done
          if (
            matchesStream(data) &&
            (!executionId || data.executionId === executionId) &&
            (executionId || !isPerExecutionOnly(data))
          ) {
            closeStream()
          }
        }
      },
      cancel() {
        if (!isStreamClosed) {
          isStreamClosed = true
          // Unmount / disposal: only detach this subscriber. Main keeps
          // generating and persists the result; abort is a separate IPC.
          ipcApi
            .request('ai.stream.detach', { topicId })
            .catch((e) => logger.warn('streamDetach failed', { topicId, e }))
          cleanup()
        }
      }
    })
  }
}

export const ipcChatTransport = new IpcChatTransport()
