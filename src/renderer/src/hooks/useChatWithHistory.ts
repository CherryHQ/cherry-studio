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

import { useChat } from '@ai-sdk/react'
import { loggerService } from '@logger'
import { ensureTopicStreamStateSyncStarted } from '@renderer/services/topicStreamStateSync'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import { useEffect, useMemo, useRef } from 'react'

const logger = loggerService.withContext('useChatWithHistory')

// ── Data source interface (pluggable) ──

export interface ChatHistory {
  messages: Message[]
  partsMap: Record<string, CherryMessagePart[]>
  isLoading: boolean
  refresh: () => Promise<CherryUIMessage[]>
  activeNodeId: string | null
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  history: ChatHistory,
  /** assistantId + topicId for adapting live UIMessages to legacy Message[] */
  context: { assistantId: string }
) {
  useEffect(() => {
    ensureTopicStreamStateSyncStarted()
  }, [])

  const {
    messages: streamingUIMessages,
    setMessages,
    stop,
    status,
    error,
    sendMessage,
    regenerate
  } = useChat<CherryUIMessage>({
    id: topicId,
    transport: ipcChatTransport,
    experimental_throttle: 50,
    onError: (streamError) => {
      logger.error('AI stream error', { topicId, streamError })
    }
  })

  // On stream done: refresh history first, then clear live messages to avoid flash
  useEffect(() => {
    const unsubscribe = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      void history
        .refresh()
        .then(() => setMessages([]))
        .catch((err) => {
          logger.warn('Failed to refresh messages after stream done', { topicId, err })
          setMessages([])
        })
    })
    return () => {
      unsubscribe()
    }
  }, [history.refresh, setMessages, topicId]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Adapt live UIMessages to legacy Message[] ──

  const timestampCacheRef = useRef(new Map<string, string>())

  const liveAdapted = useMemo<Message[]>(() => {
    const cache = timestampCacheRef.current
    const activeIds = new Set<string>()

    const messages = streamingUIMessages.map((uiMsg) => {
      activeIds.add(uiMsg.id)
      let ts = cache.get(uiMsg.id)
      if (!ts) {
        ts = new Date().toISOString()
        cache.set(uiMsg.id, ts)
      }
      return {
        id: uiMsg.id,
        role: uiMsg.role,
        assistantId: context.assistantId,
        topicId,
        createdAt: ts,
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
  }, [streamingUIMessages, context.assistantId, topicId, status])

  // ── Merge history + live ──

  const adaptedMessages = useMemo<Message[]>(() => {
    if (liveAdapted.length === 0) return history.messages
    const seen = new Set(history.messages.map((m) => m.id))
    const deduped = liveAdapted.filter((m) => !seen.has(m.id))
    if (deduped.length === 0) return history.messages
    return [...history.messages, ...deduped]
  }, [history.messages, liveAdapted])

  const partsMap = useMemo<Record<string, CherryMessagePart[]>>(() => {
    if (streamingUIMessages.length === 0) return history.partsMap
    const map: Record<string, CherryMessagePart[]> = { ...history.partsMap }
    for (const uiMsg of streamingUIMessages) {
      map[uiMsg.id] = uiMsg.parts as CherryMessagePart[]
    }
    return map
  }, [history.partsMap, streamingUIMessages])

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
