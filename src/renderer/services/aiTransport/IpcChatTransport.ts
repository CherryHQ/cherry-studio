import { loggerService } from '@logger'
import { ipcApi } from '@renderer/ipc'
import {
  ConversationAttachStatus,
  ConversationKind,
  ConversationOpenMode,
  ConversationOpenTrigger,
  type ConversationRef,
  conversationRefsEqual,
  ConversationStreamTerminalStatus
} from '@shared/ai/conversation'
import type { AiChatRequestBody, AiStreamOpenRequest } from '@shared/ai/transport'
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
    const stream = this.buildListenerStream(conversation, abortSignal)

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
    logger.info('Reconnected to stream', { topicId })
    return this.buildListenerStream(conversation, undefined, releaseAttachment)
  }

  private buildListenerStream(
    conversation: ConversationRef,
    abortSignal?: AbortSignal,
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
          })
        )

        unsubscribers.push(
          ipcApi.on('ai.stream.done', (data) => {
            if (!matchesConversation(data)) return
            if (isPerExecutionOnly(data)) return
            closeStream()
          })
        )

        unsubscribers.push(
          ipcApi.on('ai.stream.error', (data) => {
            if (!matchesConversation(data)) return
            if (isPerExecutionOnly(data)) return
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
