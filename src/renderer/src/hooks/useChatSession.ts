/**
 * useChatSession — React consumer hook for ChatSessionManager.
 *
 * Subscribes to a ChatSession's Chat instance via useSyncExternalStore.
 * Component mount → retain(). Component unmount → release().
 * Stream survives unmount because ChatSession lives in the service layer.
 */

import type { CherryUIMessage } from '@renderer/hooks/useAiChat'
import { chatSessionManager, type ChatSessionOptions, MESSAGE_THROTTLE_MS } from '@renderer/services/ChatSessionManager'
import type { ChatRequestOptions, ChatStatus } from 'ai'
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react'

export interface UseChatSessionReturn {
  messages: CherryUIMessage[]
  status: ChatStatus
  error: Error | undefined
  sendMessage: (message?: { text: string }, options?: ChatRequestOptions) => Promise<void>
  stop: () => Promise<void>
  regenerate: (messageId?: string, options?: ChatRequestOptions) => Promise<void>
  setMessages: (msgs: CherryUIMessage[] | ((prev: CherryUIMessage[]) => CherryUIMessage[])) => void
}

export function useChatSession(topicId: string, options: ChatSessionOptions): UseChatSessionReturn {
  // Get or create session — stable for same topicId across re-renders.
  // When topicId changes, getOrCreate returns a different session.
  const session = useMemo(
    () => chatSessionManager.getOrCreate(options),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally keyed on topicId only
    [topicId]
  )

  // Keep mutable context in sync when props change (assistant, historyIds, refresh)
  useEffect(() => {
    session.updateContext({
      topic: options.topic,
      historyIds: options.historyIds,
      refresh: options.refresh
    })
  }, [session, options.topic, options.historyIds, options.refresh])

  // Retain on mount, release on unmount
  useEffect(() => {
    chatSessionManager.retain(topicId)
    return () => chatSessionManager.release(topicId)
  }, [topicId])

  // Subscribe to Chat instance state via useSyncExternalStore
  const messages = useSyncExternalStore(
    useCallback((cb: () => void) => session.chat['~registerMessagesCallback'](cb, MESSAGE_THROTTLE_MS), [session]),
    useCallback(() => session.chat.messages, [session])
  )

  const status = useSyncExternalStore(
    useCallback((cb: () => void) => session.chat['~registerStatusCallback'](cb), [session]),
    useCallback(() => session.chat.status, [session])
  )

  const error = useSyncExternalStore(
    useCallback((cb: () => void) => session.chat['~registerErrorCallback'](cb), [session]),
    useCallback(() => session.chat.error, [session])
  )

  // Stable method references — point to session.chat, not component state
  const sendMessage = useCallback(
    (message?: { text: string }, requestOptions?: ChatRequestOptions) =>
      session.chat.sendMessage(message, {
        ...requestOptions,
        body: { topicId, assistantId: options.assistantId, ...requestOptions?.body }
      }),
    [session, topicId, options.assistantId]
  )

  const stop = useCallback(() => session.chat.stop(), [session])

  const regenerate = useCallback(
    (messageId?: string, requestOptions?: ChatRequestOptions) =>
      session.chat.regenerate({
        messageId,
        ...requestOptions,
        body: { topicId, assistantId: options.assistantId, ...requestOptions?.body }
      }),
    [session, topicId, options.assistantId]
  )

  const setMessages = useCallback(
    (msgs: CherryUIMessage[] | ((prev: CherryUIMessage[]) => CherryUIMessage[])) => {
      if (typeof msgs === 'function') {
        session.chat.messages = msgs(session.chat.messages)
      } else {
        session.chat.messages = msgs
      }
    },
    [session]
  )

  return { messages, status, error, sendMessage, stop, regenerate, setMessages }
}
