import { useChat, type UseChatHelpers } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { IpcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { CherryDataPartTypes } from '@shared/data/types/uiParts'
import type { ChatRequestOptions, UIMessage } from 'ai'
import { useCallback } from 'react'

const logger = loggerService.withContext('useAiChat')

/**
 * Cherry Studio custom UIMessage type with metadata and DataUIPart extensions.
 *
 * - METADATA: token usage metadata
 * - DATA_PARTS: Cherry Studio custom block types (citation, translation, error, video, compact, code)
 */
export type CherryUIMessage = UIMessage<{ totalTokens?: number }, CherryDataPartTypes>

/** Singleton transport — stateless, safe to share across hook instances. */
const transport = new IpcChatTransport()

export interface UseAiChatOptions {
  /** Conversation identifier. Maps to `useChat({ id })`. */
  chatId: string
  /** Topic ID for message persistence (Data API URL path). */
  topicId: string
  /** Assistant ID for CreateMessageDto. */
  assistantId?: string
  /** Pre-existing messages to populate the chat. */
  initialMessages?: CherryUIMessage[]
  /** Called when an assistant message finishes streaming. */
  onFinish?: (message: CherryUIMessage, isAbort: boolean, isError: boolean) => void
  /** Called when an error occurs during streaming. */
  onError?: (error: Error) => void
}

export type UseAiChatReturn = Omit<UseChatHelpers<CherryUIMessage>, 'regenerate' | 'sendMessage'> & {
  /** Send a message with topicId/assistantId auto-injected into body. */
  sendMessage: UseChatHelpers<CherryUIMessage>['sendMessage']
  /** Regenerate an assistant message by ID (or the last one if omitted). */
  regenerate: (messageId?: string, requestOptions?: ChatRequestOptions) => Promise<void>
}

/**
 * Unified AI chat hook for Cherry Studio.
 *
 * Wraps AI SDK `useChat` with:
 * - IPC transport (Renderer ↔ Main streaming)
 * - Cherry Studio custom DataUIPart types
 * - Throttled rendering (50ms)
 *
 * `topicId` and `assistantId` are auto-injected into every request's `body`
 * (both sendMessage and regenerate) so the Main process always receives them.
 * Per-call body (e.g. `files`, `mentionedModels`) is shallow-merged on top.
 */
export function useAiChat(options: UseAiChatOptions): UseAiChatReturn {
  const {
    chatId,
    topicId,
    assistantId,
    initialMessages,
    onFinish: onFinishCallback,
    onError: onErrorCallback
  } = options

  const chat = useChat<CherryUIMessage>({
    id: chatId,
    transport,
    messages: initialMessages,
    experimental_throttle: 50,
    onFinish: ({ message, isAbort, isError }) => {
      onFinishCallback?.(message, isAbort, isError)
    },
    onError: (error) => {
      logger.error('AI stream error', error)
      onErrorCallback?.(error)
    }
  })

  // Destructure for stable useCallback references
  const { sendMessage: chatSendMessage, regenerate: chatRegenerate } = chat

  /** Inject topicId/assistantId into body for every sendMessage call. */
  const sendMessage: UseChatHelpers<CherryUIMessage>['sendMessage'] = useCallback(
    (message, options_) => {
      const mergedBody = { topicId, assistantId, ...options_?.body }
      return chatSendMessage(message, { ...options_, body: mergedBody })
    },
    [chatSendMessage, topicId, assistantId]
  )

  /** Inject topicId/assistantId into body for every regenerate call. */
  const regenerate = useCallback(
    (messageId?: string, requestOptions?: ChatRequestOptions) => {
      const mergedBody = { topicId, assistantId, ...requestOptions?.body }
      return chatRegenerate({ messageId, ...requestOptions, body: mergedBody })
    },
    [chatRegenerate, topicId, assistantId]
  )

  return { ...chat, sendMessage, regenerate }
}
