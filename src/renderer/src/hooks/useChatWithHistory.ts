/**
 * Shared hook: useChat streaming + history merge.
 *
 * Composes the AI SDK's useChat with a pluggable history data source.
 * Handles: streaming ↔ history merge, partsMap construction, live→legacy message adapt.
 * Does NOT handle: message operations (delete/edit), capabilities, inputbar — those are consumer-specific.
 *
 * Used by:
 *   - V2ChatContent (normal chat, history from useTopicMessagesV2)
 *   - AgentSessionMessages (agent, history from useAgentSessionParts)
 */

import { Chat, useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { useCache } from '@renderer/data/hooks/useCache'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useCallback, useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useChatWithHistory')

// ── Data source interface (pluggable) ──

export interface ChatHistory {
  messages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
  isLoading: boolean
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
}

interface ChatSessionCache {
  chat: Chat<CherryUIMessage>
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  history: ChatHistory,
  /** assistantId + topicId for adapting live UIMessages to legacy Message[] */
  context: { assistantId: string }
) {
  const cacheKey = `message.streaming.chat_session.${topicId}` as const
  const [cachedSession, setCachedSession] = useCache(cacheKey, null)

  const chat = useMemo(
    () =>
      cachedSession?.chat ??
      new Chat<CherryUIMessage>({
        id: topicId,
        transport: ipcChatTransport,
        onError: (streamError) => {
          logger.error('AI stream error', { topicId, streamError })
        }
      }),
    [cachedSession, topicId]
  )

  useEffect(() => {
    if (cachedSession?.chat === chat) return
    setCachedSession({ chat } as ChatSessionCache)
  }, [cachedSession, chat, setCachedSession])

  const {
    messages: streamingUIMessages,
    setMessages,
    stop,
    status,
    error,
    sendMessage,
    regenerate
  } = useChat<CherryUIMessage>({
    chat,
    experimental_throttle: 50
  })

  // Stable ref for history.refresh — avoids re-subscribing IPC listeners
  // when the refresh function identity changes between renders.
  const refreshRef = useRef(history.refresh)
  refreshRef.current = history.refresh

  const refreshAndClear = useCallback(() => {
    void refreshRef
      .current()
      .then(() => setMessages([]))
      .catch((err) => {
        logger.warn('Failed to refresh messages after stream end', { topicId, err })
        setMessages([])
      })
  }, [setMessages, topicId])

  // On stream done/error: refresh history, then clear live messages to avoid flash
  useEffect(() => {
    const doneUnsub = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      refreshAndClear()
    })
    const errorUnsub = window.api.ai.onStreamError((data) => {
      if (data.topicId !== topicId) return
      refreshAndClear()
    })
    return () => {
      doneUnsub()
      errorUnsub()
    }
  }, [topicId, refreshAndClear])

  const isLiveStreamActive = status === 'streaming' || status === 'submitted'
  const activeHistoryMessage = useMemo(
    () => history.messages.find((message) => message.id === history.activeNodeId) ?? null,
    [history.activeNodeId, history.messages]
  )
  const persistedStreamingUserId = activeHistoryMessage?.role === 'user' ? activeHistoryMessage.id : null
  const shouldDiscardCompletedLiveMessages =
    !isLiveStreamActive && activeHistoryMessage?.role === 'assistant' && streamingUIMessages.length > 0
  // Synchronous filter only — actual clearing is handled by onStreamDone/onStreamError effects above.
  const effectiveStreamingUIMessages = shouldDiscardCompletedLiveMessages ? [] : streamingUIMessages

  // ── Adapt live UIMessages to legacy Message[] ──

  const timestampCacheRef = useRef(new Map<string, string>())
  const liveUserMessage = useMemo(
    () => effectiveStreamingUIMessages.find((message) => message.role === 'user') ?? null,
    [effectiveStreamingUIMessages]
  )
  const liveConversationUserId = persistedStreamingUserId ?? liveUserMessage?.id ?? null

  const liveAdapted = useMemo<Message[]>(() => {
    const cache = timestampCacheRef.current
    const activeIds = new Set<string>()

    const messages = effectiveStreamingUIMessages.map((uiMsg) => {
      const renderedId = uiMsg.role === 'user' ? (liveConversationUserId ?? uiMsg.id) : uiMsg.id

      activeIds.add(renderedId)
      let ts = cache.get(renderedId)
      if (!ts) {
        ts = new Date().toISOString()
        cache.set(renderedId, ts)
      }
      return {
        id: renderedId,
        role: uiMsg.role,
        assistantId: context.assistantId,
        topicId,
        createdAt: ts,
        askId: uiMsg.role === 'assistant' ? (liveConversationUserId ?? undefined) : undefined,
        status:
          uiMsg.role === 'user'
            ? UserMessageStatus.SUCCESS
            : status === 'streaming' || status === 'submitted'
              ? AssistantMessageStatus.PROCESSING
              : AssistantMessageStatus.SUCCESS,
        blocks: []
      }
    })

    for (const key of cache.keys()) {
      if (!activeIds.has(key)) cache.delete(key)
    }

    return messages
  }, [context.assistantId, effectiveStreamingUIMessages, liveConversationUserId, topicId, status])

  // ── Merge history + live ──

  const adaptedMessages = useMemo<Message[]>(() => {
    if (liveAdapted.length === 0) return history.messages
    const seen = new Set(history.messages.map((m) => m.id))
    const deduped = liveAdapted.filter((m) => !seen.has(m.id))
    if (deduped.length === 0) return history.messages
    return [...history.messages, ...deduped]
  }, [history.messages, liveAdapted])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    if (effectiveStreamingUIMessages.length === 0) return history.partsMap
    const map: Record<string, CherryMessagePart[]> = { ...history.partsMap }
    for (const uiMsg of effectiveStreamingUIMessages) {
      const messageId = uiMsg.role === 'user' ? (liveConversationUserId ?? uiMsg.id) : uiMsg.id
      map[messageId] = uiMsg.parts as CherryMessagePart[]
    }
    return map
  }, [effectiveStreamingUIMessages, history.partsMap, liveConversationUserId])

  return {
    // Merged state
    adaptedMessages,
    partsMap,
    // useChat primitives (consumers wrap with their own capability logic)
    sendMessage,
    regenerate,
    stop,
    status,
    error,
    setMessages,
    streamingUIMessages
  }
}
