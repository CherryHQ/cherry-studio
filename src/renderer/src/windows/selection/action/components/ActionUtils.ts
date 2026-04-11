import { loggerService } from '@logger'
import { getAssistantMessage, getUserMessage } from '@renderer/services/MessagesService'
import { IpcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Assistant, Topic } from '@renderer/types'
import { ERROR_I18N_KEY_REQUEST_TIMEOUT, ERROR_I18N_KEY_STREAM_PAUSED } from '@renderer/types/error'
import {
  AssistantMessageStatus,
  type Message,
  type MessageBlock,
  MessageBlockStatus,
  MessageBlockType
} from '@renderer/types/newMessage'
import { addAbortController, removeAbortController } from '@renderer/utils/abortController'
import { blocksToParts } from '@renderer/utils/blocksToparts'
import { formatErrorMessage, isAbortError, isTimeoutError } from '@renderer/utils/error'
import { createErrorBlock, createMainTextBlock, createThinkingBlock } from '@renderer/utils/messageUtils/create'
import type { CherryMessagePart } from '@shared/data/types/message'
import type { UIMessage, UIMessageChunk } from 'ai'
import { cloneDeep } from 'lodash'

const logger = loggerService.withContext('ActionUtils')
const transport = new IpcChatTransport()

type MainStreamChunk = UIMessageChunk & {
  delta?: string
  text?: string
  error?: unknown
}

const resolveChunkText = (chunk: MainStreamChunk): string => {
  if (typeof chunk.delta === 'string') return chunk.delta
  if (typeof chunk.text === 'string') return chunk.text
  return ''
}

const toError = (error: unknown): Error => {
  if (error instanceof Error) return error
  if (typeof error === 'string') return new Error(error)
  return new Error('Unknown stream error')
}

export interface ActionSessionSnapshot {
  assistantMessage: Message
  partsMap: Record<string, CherryMessagePart[]>
}

const buildRuntimeAssistantOverrides = (assistant: Assistant) => ({
  prompt: assistant.prompt,
  settings: assistant.settings,
  enableWebSearch: assistant.enableWebSearch ?? false,
  webSearchProviderId: assistant.webSearchProviderId,
  enableUrlContext: assistant.enableUrlContext,
  enableGenerateImage: assistant.enableGenerateImage
})

const buildPartsFromBlocks = (blocks: MessageBlock[]): CherryMessagePart[] => {
  const parts = blocksToParts(blocks)

  return parts.map((part, index) => {
    const block = blocks[index]
    if (!block) return part

    if (part.type === 'reasoning' && block.type === MessageBlockType.THINKING) {
      return {
        ...part,
        providerMetadata: {
          ...part.providerMetadata,
          cherry: {
            thinkingMs: block.thinking_millsec
          }
        }
      } as CherryMessagePart
    }

    return part
  })
}

export const processMessages = async (
  assistant: Assistant,
  topic: Topic,
  promptContent: string,
  setAskId: (id: string) => void,
  onSessionUpdate: (snapshot: ActionSessionSnapshot) => void,
  onStream: () => void,
  onFinish: (content: string) => void,
  onError: (error: Error) => void
) => {
  if (!assistant || !topic) return

  try {
    const { message: userMessage, blocks: userBlocks } = getUserMessage({
      assistant,
      topic,
      content: promptContent
    })

    setAskId(userMessage.id)

    let textBlockId: string | null = null
    let thinkingBlockId: string | null = null
    let thinkingStartTime: number | null = null
    let textBlockContent: string = ''

    const resolveThinkingDuration = (duration?: number) => {
      if (typeof duration === 'number' && Number.isFinite(duration)) {
        return duration
      }
      if (thinkingStartTime !== null) {
        return Math.max(0, performance.now() - thinkingStartTime)
      }
      return 0
    }

    const assistantMessage = getAssistantMessage({
      assistant,
      topic
    })
    let currentAssistantMessage = assistantMessage
    let assistantBlocks: MessageBlock[] = []

    let finished = false

    const emitSessionUpdate = (updates?: Partial<Message>) => {
      currentAssistantMessage = {
        ...currentAssistantMessage,
        ...updates,
        blocks: assistantBlocks.map((block) => block.id)
      }
      onSessionUpdate({
        assistantMessage: currentAssistantMessage,
        partsMap: {
          [currentAssistantMessage.id]: buildPartsFromBlocks(assistantBlocks)
        }
      })
    }

    const upsertAssistantBlock = (block: MessageBlock) => {
      const blockIndex = assistantBlocks.findIndex((item) => item.id === block.id)
      if (blockIndex >= 0) {
        assistantBlocks = assistantBlocks.map((item, index) => (index === blockIndex ? block : item))
      } else {
        assistantBlocks = [...assistantBlocks, block]
      }
    }

    const updateAssistantBlock = (blockId: string, changes: Partial<MessageBlock>) => {
      assistantBlocks = assistantBlocks.map((block) => {
        if (block.id !== blockId) return block
        return {
          ...block,
          ...changes
        } as MessageBlock
      })
    }

    const finalizeInterruptedStream = (streamError: Error) => {
      finished = true
      const blockId = textBlockId || thinkingBlockId
      thinkingStartTime = null
      textBlockId = null
      thinkingBlockId = null
      if (blockId) {
        updateAssistantBlock(blockId, {
          status: isAbortError(streamError) ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
        })
      }
      const isErrorTypeAbort = isAbortError(streamError)
      const isErrorTypeTimeout = isTimeoutError(streamError)
      const i18nKey = isErrorTypeAbort
        ? ERROR_I18N_KEY_STREAM_PAUSED
        : isErrorTypeTimeout
          ? ERROR_I18N_KEY_REQUEST_TIMEOUT
          : undefined
      const serializableError = {
        name: streamError.name,
        message: streamError.message || formatErrorMessage(streamError),
        originalMessage: streamError.message,
        ...(i18nKey && { i18nKey }),
        stack: streamError.stack ?? null,
        ...(streamError instanceof Object && 'status' in streamError && { status: (streamError as any).status }),
        ...(streamError instanceof Object && 'code' in streamError && { code: (streamError as any).code }),
        ...(streamError instanceof Object &&
          'request_id' in streamError && { requestId: (streamError as any).request_id })
      }
      const errorBlock = createErrorBlock(assistantMessage.id, serializableError, {
        status: isErrorTypeAbort ? MessageBlockStatus.PAUSED : MessageBlockStatus.ERROR
      })
      upsertAssistantBlock(errorBlock)
      emitSessionUpdate({
        status: isErrorTypeAbort ? AssistantMessageStatus.PAUSED : AssistantMessageStatus.ERROR
      })
      onFinish(textBlockContent)
    }

    const newAssistant = cloneDeep(assistant)
    if (!newAssistant.settings) {
      newAssistant.settings = {}
    }
    newAssistant.settings.streamOutput = true
    // 显式关闭这些功能
    newAssistant.webSearchProviderId = undefined
    newAssistant.mcpServers = undefined
    newAssistant.knowledge_bases = undefined
    const abortController = new AbortController()
    const abortFn = () => abortController.abort()
    addAbortController(userMessage.id, abortFn)

    try {
      const model = newAssistant.model
      if (!model) {
        throw new Error('Assistant model is required.')
      }

      const parts = blocksToParts(userBlocks) as UIMessage['parts']
      const uiUserMessage: UIMessage = {
        id: userMessage.id,
        role: 'user',
        parts: parts.length > 0 ? parts : ([{ type: 'text', text: promptContent }] as UIMessage['parts'])
      } as UIMessage

      const stream = await transport.sendMessages({
        trigger: 'submit-message',
        chatId: topic.id,
        messageId: undefined,
        messages: [uiUserMessage],
        abortSignal: abortController.signal,
        body: {
          topicId: topic.id,
          assistantId: newAssistant.id,
          providerId: model.provider,
          modelId: model.id,
          mcpToolIds: [],
          assistantOverrides: buildRuntimeAssistantOverrides(newAssistant)
        } as Record<string, unknown>
      })

      let reasoningContent = ''
      const reader = stream.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done || finished) {
            break
          }
          const chunk = value as MainStreamChunk
          switch (chunk.type) {
            case 'reasoning-start':
              {
                thinkingStartTime = performance.now()
                if (thinkingBlockId) {
                  updateAssistantBlock(thinkingBlockId, { status: MessageBlockStatus.STREAMING })
                } else {
                  const block = createThinkingBlock(assistantMessage.id, '', {
                    status: MessageBlockStatus.STREAMING
                  })
                  thinkingBlockId = block.id
                  upsertAssistantBlock(block)
                }
                emitSessionUpdate()
              }
              break
            case 'reasoning-delta':
              {
                const delta = resolveChunkText(chunk)
                if (delta && thinkingBlockId) {
                  if (thinkingStartTime === null) {
                    thinkingStartTime = performance.now()
                  }
                  reasoningContent += delta
                  const thinkingDuration = resolveThinkingDuration(undefined)
                  updateAssistantBlock(thinkingBlockId, {
                    content: reasoningContent,
                    thinking_millsec: thinkingDuration
                  })
                  emitSessionUpdate()
                }
                onStream()
              }
              break
            case 'reasoning-end':
              {
                if (thinkingBlockId) {
                  const thinkingDuration = resolveThinkingDuration(undefined)
                  updateAssistantBlock(thinkingBlockId, {
                    content: reasoningContent,
                    status: MessageBlockStatus.SUCCESS,
                    thinking_millsec: thinkingDuration
                  })
                  thinkingBlockId = null
                  emitSessionUpdate()
                }
                thinkingStartTime = null
              }
              break
            case 'text-start':
              {
                if (textBlockId) {
                  updateAssistantBlock(textBlockId, { status: MessageBlockStatus.STREAMING })
                } else {
                  const block = createMainTextBlock(assistantMessage.id, '', {
                    status: MessageBlockStatus.STREAMING
                  })
                  textBlockId = block.id
                  upsertAssistantBlock(block)
                }
                emitSessionUpdate()
              }
              break
            case 'text-delta':
              {
                const delta = resolveChunkText(chunk)
                if (delta) {
                  textBlockContent += delta
                  if (textBlockId) {
                    updateAssistantBlock(textBlockId, { content: textBlockContent })
                    emitSessionUpdate()
                  }
                  onStream()
                }
              }
              break
            case 'text-end':
              {
                if (textBlockId) {
                  updateAssistantBlock(textBlockId, {
                    content: textBlockContent,
                    status: MessageBlockStatus.SUCCESS
                  })
                  emitSessionUpdate()
                  onFinish(textBlockContent)
                  textBlockId = null
                }
              }
              break
            case 'finish':
              {
                finished = true
                emitSessionUpdate({ status: AssistantMessageStatus.SUCCESS })
              }
              break
            case 'abort':
            case 'error':
              {
                const streamError =
                  chunk.type === 'abort' ? new DOMException('Request was aborted', 'AbortError') : toError(chunk.error)
                finalizeInterruptedStream(streamError)
              }
              break
            default:
          }
        }
        if (!finished && abortController.signal.aborted) {
          finalizeInterruptedStream(new DOMException('Request was aborted', 'AbortError'))
        }
      } finally {
        reader.releaseLock()
      }
    } finally {
      removeAbortController(userMessage.id, abortFn)
    }
  } catch (err) {
    if (isAbortError(err)) return
    onError(err instanceof Error ? err : new Error('An error occurred'))
    logger.error('Error fetching result:', err as Error)
  }
}
