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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { MessageMetadataMap } from './useTopicMessagesV2'

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
  /** Multi-model: active execution IDs during streaming. Empty for single-model. */
  activeExecutionIds: string[]
  seedActiveExecutionIds: (executionIds: string[]) => void
  /** The initialMessages passed through (for multi-model view to share history). */
  initialMessages: CherryUIMessage[]
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>,
  context: { assistantId: string },
  metadataMap: MessageMetadataMap = {}
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
  const terminalRefreshRef = useRef<Promise<void> | null>(null)
  const liveCreatedAtRef = useRef<Record<string, string>>({})

  const refreshAndReplace = useCallback(() => {
    if (terminalRefreshRef.current) return terminalRefreshRef.current

    const refreshPromise = refreshRef
      .current()
      .then((refreshed) => {
        setMessages(refreshed)
        // Do NOT clear activeExecutionIds here — ExecutionStreamCollectors
        // hold the final messages and keep the multi-model view alive.
        // Clearing happens on topic change or new message send.
      })
      .catch((err) => {
        logger.warn('Failed to refresh messages after stream end', { topicId, err })
      })
      .finally(() => {
        terminalRefreshRef.current = null
      })

    terminalRefreshRef.current = refreshPromise
    return refreshPromise
  }, [setMessages, topicId])

  useEffect(() => {
    setActiveExecutionIds([])
    terminalRefreshRef.current = null
    liveCreatedAtRef.current = {}
  }, [topicId])

  // On stream done/error: replace messages with DB truth
  useEffect(() => {
    const doneUnsub = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      // Multi-model: skip per-execution done, only refresh when all executions finish
      if (data.executionId && !data.isTopicDone) return
      void refreshAndReplace()
    })
    const errorUnsub = window.api.ai.onStreamError((data) => {
      if (data.topicId !== topicId) return
      if (data.executionId && !data.isTopicDone) return
      void refreshAndReplace()
    })
    return () => {
      doneUnsub()
      errorUnsub()
    }
  }, [topicId, refreshAndReplace])

  // Multi-model: track active executionIds from chunk events.
  // Chunks with executionId indicate multi-model streaming.
  const [activeExecutionIds, setActiveExecutionIds] = useState<string[]>([])
  const seedActiveExecutionIds = useCallback((executionIds: string[]) => {
    // Empty array = clear multi-model state (used by new message sends)
    if (executionIds.length === 0) {
      setActiveExecutionIds([])
      return
    }

    setActiveExecutionIds((prev) => {
      const next = prev.length === 0 ? [...executionIds] : Array.from(new Set([...prev, ...executionIds]))
      return next.length === prev.length && next.every((id, index) => id === prev[index]) ? prev : next
    })
  }, [])

  useEffect(() => {
    const seen = new Set<string>()
    const chunkUnsub = window.api.ai.onStreamChunk((data) => {
      if (data.topicId !== topicId || !data.executionId) return
      if (seen.has(data.executionId)) return
      seen.add(data.executionId)
      seedActiveExecutionIds([data.executionId])
    })
    // activeExecutionIds is cleared by refreshAndReplace (after DB refresh completes)
    return () => {
      chunkUnsub()
      seen.clear()
    }
  }, [seedActiveExecutionIds, topicId])

  // ── Adapt UIMessage[] to renderer Message[] ──

  const adaptedMessages = useMemo<Message[]>(() => {
    let lastUserId: string | undefined
    return messages.map((uiMsg) => {
      if (uiMsg.role === 'user') lastUserId = uiMsg.id
      const meta = metadataMap[uiMsg.id]
      const createdAt =
        meta?.createdAt ??
        uiMsg.metadata?.createdAt ??
        liveCreatedAtRef.current[uiMsg.id] ??
        (liveCreatedAtRef.current[uiMsg.id] = new Date().toISOString())
      return {
        id: uiMsg.id,
        role: uiMsg.role,
        assistantId: context.assistantId,
        topicId,
        createdAt,
        askId: meta?.parentId ?? (uiMsg.role === 'assistant' ? lastUserId : undefined),
        modelId: meta?.modelId,
        siblingsGroupId: meta?.siblingsGroupId,
        status:
          uiMsg.role === 'user'
            ? UserMessageStatus.SUCCESS
            : status === 'streaming' || status === 'submitted'
              ? AssistantMessageStatus.PROCESSING
              : AssistantMessageStatus.SUCCESS,
        blocks: []
      }
    })
  }, [messages, context.assistantId, topicId, status, metadataMap])

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
    streamingUIMessages: messages,
    activeExecutionIds,
    seedActiveExecutionIds,
    initialMessages
  }
}
