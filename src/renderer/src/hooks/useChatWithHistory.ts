/**
 * Shared hook: useChat as single data source.
 *
 * History from DB is passed as `messages` (seeds Chat on topicId change).
 * useChat.messages is the sole rendering source — no merge, no dedup.
 * On stream done, DB is refreshed and setMessages replaces with truth.
 *
 * Used by:
 *   - V2ChatContent (normal chat, history from useTopicMessagesV2)
 *   - AgentChat (agent, history from useAgentSessionParts)
 */

import { useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { ChatRequestOptions, ChatStatus } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useChatWithHistory')

// ── Return type ──

export interface UseChatWithHistoryResult {
  adaptedMessages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
  sendMessage: (message?: { text: string }, options?: ChatRequestOptions) => Promise<void>
  regenerate: (options?: ChatRequestOptions & { messageId?: string }) => Promise<void>
  stop: () => Promise<void>
  status: ChatStatus
  error: Error | undefined
  setMessages: (messages: CherryUIMessage[] | ((messages: CherryUIMessage[]) => CherryUIMessage[])) => void
  streamingUIMessages: CherryUIMessage[]
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>,
  context: { assistantId: string }
): UseChatWithHistoryResult {
  const { messages, setMessages, stop, status, error, sendMessage, regenerate } = useChat<CherryUIMessage>({
    id: topicId,
    transport: ipcChatTransport,
    messages: initialMessages,
    resume: true,
    experimental_throttle: 50,
    onError: (streamError) => {
      logger.error('AI stream error', { topicId, streamError })
    }
  })

  // Stable ref for refresh to avoid re-subscribing IPC listeners
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const refreshAndReplace = useCallback(() => {
    void refreshRef
      .current()
      .then((refreshed) => setMessages(refreshed))
      .catch((err) => {
        logger.warn('Failed to refresh messages after stream end', { topicId, err })
      })
  }, [setMessages, topicId])

  // On stream done/error: replace messages with DB truth
  useEffect(() => {
    const doneUnsub = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      refreshAndReplace()
    })
    const errorUnsub = window.api.ai.onStreamError((data) => {
      if (data.topicId !== topicId) return
      refreshAndReplace()
    })
    return () => {
      doneUnsub()
      errorUnsub()
    }
  }, [topicId, refreshAndReplace])

  // ── Adapt UIMessage[] to legacy Message[] (pure map, no merge) ──

  const adaptedMessages = useMemo<Message[]>(() => {
    let lastUserId: string | undefined
    return messages.map((uiMsg) => {
      if (uiMsg.role === 'user') lastUserId = uiMsg.id
      return {
        id: uiMsg.id,
        role: uiMsg.role,
        assistantId: context.assistantId,
        topicId,
        createdAt: uiMsg.metadata?.createdAt ?? '',
        askId: uiMsg.role === 'assistant' ? lastUserId : undefined,
        status:
          uiMsg.role === 'user'
            ? UserMessageStatus.SUCCESS
            : status === 'streaming' || status === 'submitted'
              ? AssistantMessageStatus.PROCESSING
              : AssistantMessageStatus.SUCCESS,
        blocks: []
      }
    })
  }, [messages, context.assistantId, topicId, status])

  // ── PartsMap (direct from messages, no merge) ──

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    const map: Record<string, CherryMessagePart[]> = {}
    for (const msg of messages) {
      map[msg.id] = msg.parts as CherryMessagePart[]
    }
    return map
  }, [messages])

  return {
    adaptedMessages,
    partsMap,
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
    streamingUIMessages: messages
  }
}
