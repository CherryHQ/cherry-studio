import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  ConversationAttachStatus,
  type ConversationExecutionId,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  type ConversationRef,
  conversationRefsEqual,
  ConversationStreamTerminalStatus
} from '@shared/ai/conversation'
import { type AiChatRequestBody, type AiStreamOpenRequest, type StreamChunkPayload } from '@shared/ai/transport'
import type { CherryUIMessage } from '@shared/data/types/message'
import type { ChatRequestOptions, ChatTransport, UIMessageChunk } from 'ai'

import { streamAttachmentService } from './StreamAttachmentService'
import { streamDispatchService } from './StreamDispatchService'

const logger = loggerService.withContext('IpcChatTransport')

function assertNever(value: never): never {
  throw new Error(`Unhandled stream terminal status: ${String(value)}`)
}

/** Single execution terminated while other executions on the topic are still streaming. */
export function isPerExecutionOnly(data: { turnTerminal: boolean }): boolean {
  return !data.turnTerminal
}

export class IpcChatTransport implements ChatTransport<CherryUIMessage> {
  readonly #defaultBody: Partial<AiChatRequestBody>

  constructor(defaultBody: Partial<AiChatRequestBody> = {}) {
    this.#defaultBody = defaultBody
  }

  sendMessages(
    options: Parameters<ChatTransport<CherryUIMessage>['sendMessages']>[0]
  ): Promise<ReadableStream<UIMessageChunk>> {
    const { chatId: topicId, messages, abortSignal, body, trigger } = options
    const mergedBody: Partial<AiChatRequestBody> = { ...this.#defaultBody, ...body }

    const conversation = mergedBody.conversation ?? { kind: ConversationKind.Chat, id: topicId }
    const stream = this.buildListenerStream(conversation, undefined, abortSignal)

    const lastMessage = messages.at(-1)
    const ipcRequest: AiStreamOpenRequest =
      trigger === ConversationOpenTrigger.RegenerateMessage
        ? {
            trigger: ConversationOpenTrigger.RegenerateMessage,
            conversation,
            parentAnchorId: mergedBody.parentAnchorId ?? '',
            mentionedModelIds: mergedBody.mentionedModels,
            reasoningEffort: mergedBody.reasoningEffort,
            ...(mergedBody.fastMode ? { fastMode: true } : {})
          }
        : {
            trigger: ConversationOpenTrigger.SubmitMessage,
            conversation,
            parentAnchorId: mergedBody.parentAnchorId,
            userMessageParts: mergedBody.userMessageParts ?? lastMessage?.parts ?? [],
            mentionedModelIds: mergedBody.mentionedModels,
            reasoningEffort: mergedBody.reasoningEffort,
            ...(mergedBody.fastMode ? { fastMode: true } : {})
          }

    streamDispatchService.dispatch(ipcRequest)

    return Promise.resolve(stream)
  }

  async reconnectToStream(
    options: { chatId: string } & ChatRequestOptions
  ): Promise<ReadableStream<UIMessageChunk> | null> {
    const topicId = options.chatId
    const conversation = this.#defaultBody.conversation ?? { kind: ConversationKind.Chat, id: topicId }
    logger.info('reconnectToStream called', { topicId })

    const releaseAttachment = streamAttachmentService.acquire(conversation)
    const result = await ipcApi.request('ai.stream.attach', { conversation }).catch((error) => {
      releaseAttachment()
      throw error
    })
    logger.info('reconnectToStream result', { topicId, status: result.status })

    if (result.status === ConversationAttachStatus.NotFound) {
      releaseAttachment()
      return null
    }
    if (result.status === ConversationAttachStatus.Settled) {
      releaseAttachment()
      const terminal = result.terminal
      switch (terminal.status) {
        case ConversationStreamTerminalStatus.Done:
        case ConversationStreamTerminalStatus.Paused:
          return new ReadableStream<UIMessageChunk>({ start: (controller) => controller.close() })
        case ConversationStreamTerminalStatus.Error:
          return new ReadableStream<UIMessageChunk>({
            start: (controller) => controller.error(new Error(terminal.error.message ?? 'Stream error'))
          })
        default:
          return assertNever(terminal)
      }
    }
    const replay = result.executions.flatMap(({ replay }) => replay.chunks)
    logger.info('Reconnected to stream', { topicId, bufferedChunks: replay.length })
    return this.buildListenerStream(conversation, replay, undefined, undefined, releaseAttachment)
  }

  private buildListenerStream(
    conversation: ConversationRef,
    initialChunks?: StreamChunkPayload[],
    abortSignal?: AbortSignal,
    executionId?: ConversationExecutionId,
    releaseAttachment = streamAttachmentService.acquire(conversation)
  ): ReadableStream<UIMessageChunk> {
    const unsubscribers: Array<() => void> = []
    let isCleaned = false
    let isStreamClosed = false

    const cleanup = () => {
      if (isCleaned) return
      isCleaned = true
      for (const unsub of unsubscribers) unsub()
      releaseAttachment()
    }

    return new ReadableStream<UIMessageChunk>({
      start(controller) {
        if (initialChunks) {
          for (const data of initialChunks) {
            if (matchesConversation(data) && executionId && data.executionId === executionId) {
              controller.enqueue(data.chunk)
            }
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

        function matchesConversation(data: { conversation: ConversationRef }): boolean {
          return conversationRefsEqual(data.conversation, conversation)
        }

        unsubscribers.push(
          streamDispatchService.subscribe(conversation, (result) => {
            if (result.ok) {
              if (result.ack.mode === ConversationOpenMode.Blocked) closeStream()
              return
            }
            errorStream(result.error)
          }),
          ipcApi.on('ai.stream.chunk', (data) => {
            if (!matchesConversation(data) || isStreamClosed) return
            if (executionId && data.executionId !== executionId) return
            if (!executionId && data.executionId) return
            schedulePending(data.chunk)
          })
        )

        unsubscribers.push(
          ipcApi.on('ai.stream.done', (data) => {
            if (!matchesConversation(data)) return
            if (executionId && data.executionId !== executionId) return
            if (!executionId && isPerExecutionOnly(data)) return
            closeStream()
          })
        )

        unsubscribers.push(
          ipcApi.on('ai.stream.error', (data) => {
            if (!matchesConversation(data)) return
            if (executionId && data.executionId !== executionId) return
            if (!executionId && isPerExecutionOnly(data)) return
            errorStream(new Error(data.error.message ?? 'Unknown stream error'))
          })
        )

        if (abortSignal) {
          if (abortSignal.aborted) {
            ipcApi
              .request('ai.stream.abort', { conversation })
              .catch((e) => logger.warn('streamAbort failed', { conversation, e }))
            closeStream()
            return
          }

          const onAbort = () => {
            logger.info('Stream abort requested', { conversation })
            ipcApi
              .request('ai.stream.abort', { conversation })
              .catch((e) => logger.warn('streamAbort failed', { conversation, e }))
            closeStream()
          }
          abortSignal.addEventListener('abort', onAbort, { once: true })
          unsubscribers.push(() => abortSignal.removeEventListener('abort', onAbort))
        }
      },
      cancel() {
        if (!isStreamClosed) {
          isStreamClosed = true
          cleanup()
        }
      }
    })
  }
}

export const ipcChatTransport = new IpcChatTransport()
