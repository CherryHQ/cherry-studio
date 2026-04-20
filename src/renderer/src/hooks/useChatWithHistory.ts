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
import { useCache } from '@data/hooks/useCache'
import { loggerService } from '@logger'
import { ipcChatTransport } from '@renderer/transport/IpcChatTransport'
import type { Message } from '@renderer/types/newMessage'
import { AssistantMessageStatus, UserMessageStatus } from '@renderer/types/newMessage'
import { statsToMetrics, statsToUsage } from '@renderer/utils/messageStats'
import { cherryApprovalPredicate } from '@renderer/utils/toolApprovalPredicate'
import type { CherryMessagePart, CherryUIMessage } from '@shared/data/types/message'
import type { UniqueModelId } from '@shared/data/types/model'
import type { ChatRequestOptions, ChatStatus } from 'ai'
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'

import type { MessageMetadataMap } from './useTopicMessagesV2'

const logger = loggerService.withContext('useChatWithHistory')

// Module-level empty-array constant so the `?? []` fallback in
// `activeExecutionIds` keeps a stable reference when the cache is
// undefined. Prevents downstream memos / effects from invalidating on
// every render while no stream is active.
const EMPTY_EXECUTIONS: readonly UniqueModelId[] = Object.freeze([])

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
  activeExecutionIds: readonly UniqueModelId[]
  initialMessages: CherryUIMessage[]
  /**
   * Queue a UUID to be consumed by the next `Chat.generateId()` call —
   * which `makeRequest` uses to seed `activeResponse.state.message.id`
   * (see `ai/src/ui/chat.ts:659`). Pair with `body.assistantMessageId`
   * on `sendMessage` so the renderer's activeResponse and the DB
   * placeholder share the same id, avoiding the duplicate-assistant
   * bug when the first chunk arrives and AI SDK falls back to
   * `pushMessage` on id mismatch.
   */
  prepareNextAssistantId: (id: string) => void
  /**
   * AI SDK v6 native tool-approval response. Flips a `ToolUIPart` from
   * `approval-requested` to `approval-responded` on the local message.
   * For Claude Agent approvals the caller must also unblock Main via
   * `window.api.ai.toolApproval.respond` (see `useToolApprovalBridge`).
   */
  addToolApprovalResponse: (args: { id: string; approved: boolean; reason?: string }) => void | PromiseLike<void>
}

// ── Hook ──

export function useChatWithHistory(
  topicId: string,
  initialMessages: CherryUIMessage[],
  refresh: () => Promise<CherryUIMessage[]>,
  context: { assistantId: string },
  metadataMap: MessageMetadataMap = {}
): UseChatWithHistoryResult {
  // Single-slot queue for the next id `Chat.generateId()` should return.
  // `V2ChatContent.handleSendV2` writes a UUID here right before calling
  // `sendMessage` and also threads it into `body.assistantMessageId`, so
  // the assistant id ends up identical on three sides: the renderer's
  // `activeResponse.state.message`, `useChat.state.messages`, and the DB
  // placeholder row created by Main.
  const pendingAssistantIdRef = useRef<string | null>(null)
  const generateId = useCallback(() => {
    const queued = pendingAssistantIdRef.current
    if (queued) {
      pendingAssistantIdRef.current = null
      return queued
    }
    return uuidv4()
  }, [])

  const { messages, setMessages, stop, status, error, sendMessage, regenerate, resumeStream, addToolApprovalResponse } =
    useChat<CherryUIMessage>({
      id: topicId,
      transport: ipcChatTransport,
      messages: initialMessages,
      experimental_throttle: 50,
      sendAutomaticallyWhen: cherryApprovalPredicate,
      generateId,
      onError: (streamError) => {
        logger.error('AI stream error', { topicId, streamError })
      }
    })

  const prepareNextAssistantId = useCallback((id: string) => {
    pendingAssistantIdRef.current = id
  }, [])

  // Stable ref for refresh to avoid re-subscribing IPC listeners
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  // Active execution IDs for this topic are mirrored from Main's
  // `AiStreamManager` via the topic-status push channel (see
  // `aiStreamTopicCache`). Absence / empty cache value means "no
  // executions currently running".
  const [activeExecutionIdsFromCache] = useCache(`topic.stream.executions.${topicId}` as const)
  const activeExecutionIds = activeExecutionIdsFromCache ?? EMPTY_EXECUTIONS

  const resumeInFlightRef = useRef<Promise<void> | null>(null)
  const latestAssistantMessageId = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index--) {
      const message = messages[index]
      if (message.role === 'assistant') return message.id
    }
    return undefined
  }, [messages])

  const resumeActiveStream = useCallback(
    (reason: 'mount' | 'started-event') => {
      if (reason === 'mount' && (status === 'streaming' || status === 'submitted')) return
      if (resumeInFlightRef.current) return

      resumeInFlightRef.current = (async () => {
        if (reason === 'started-event') {
          // Only seed state from the DB placeholder row when there's nothing
          // live yet. Once the stream is already producing chunks,
          // overwriting `messages` with the DB snapshot (placeholder still
          // has empty parts) would wipe the in-flight content and reset
          // the latest assistant to "pending".
          if (status === 'streaming') {
            return
          }
          try {
            const refreshed = await refreshRef.current()
            setMessages(refreshed)
          } catch (err) {
            logger.warn('Failed to refresh messages before resuming stream', { topicId, err })
          }
        }

        if (status === 'streaming' || status === 'submitted') {
          return
        }

        await resumeStream()
      })()
        .catch((err) => {
          logger.warn('Failed to resume active stream', { topicId, reason, err })
        })
        .finally(() => {
          resumeInFlightRef.current = null
        })
    },
    [resumeStream, setMessages, status, topicId]
  )

  useEffect(() => {
    resumeActiveStream('mount')
  }, [resumeActiveStream])

  useEffect(() => {
    // Trigger reattach when Main notifies that a new stream has been
    // created on this topic. The `pending` transition uniquely marks
    // "send() just created a new ActiveStream" — subsequent deltas
    // (streaming / done / error / aborted / idle) describe an ongoing
    // lifecycle and must not retrigger a reattach.
    const unsub = window.api.ai.topic.onStatusChanged((data) => {
      if (data.topicId !== topicId) return
      if (data.status !== 'pending') return
      resumeActiveStream('started-event')
    })

    return () => {
      unsub()
    }
  }, [resumeActiveStream, topicId])

  const refreshAndReplace = useCallback(() => {
    void refreshRef
      .current()
      .then((refreshed) => {
        setMessages(refreshed)
      })
      .catch((err) => {
        logger.warn('Failed to refresh messages after stream end', { topicId, err })
      })
  }, [setMessages, topicId])

  // On stream done/error: replace messages with DB truth.
  // Multi-model: skip per-execution events, only refresh when the topic is done.
  useEffect(() => {
    const doneUnsub = window.api.ai.onStreamDone((data) => {
      if (data.topicId !== topicId) return
      if (data.executionId && !data.isTopicDone) return
      refreshAndReplace()
    })
    const errorUnsub = window.api.ai.onStreamError((data) => {
      if (data.topicId !== topicId) return
      if (data.executionId && !data.isTopicDone) return
      refreshAndReplace()
    })
    return () => {
      doneUnsub()
      errorUnsub()
    }
  }, [topicId, refreshAndReplace])

  // ── Adapt UIMessage[] to renderer Message[] ──

  const adaptedMessages = useMemo<Message[]>(() => {
    let lastUserId: string | undefined
    return messages.map((uiMsg) => {
      if (uiMsg.role === 'user') lastUserId = uiMsg.id
      const meta = metadataMap[uiMsg.id]
      // Stats come from DB via metadataMap; during live streaming the
      // UIMessage carries no stats yet (timings are only computed at
      // persist time), so `usage` / `metrics` light up when the
      // `refreshAndReplace` after `onStreamDone` pulls fresh metadata.
      // TODO: adaptedMessages also doesn't populate `message.model` —
      // MessageTokens needs it for price calculation. Unrelated to stats
      // projection; track as a follow-up.
      return {
        id: uiMsg.id,
        role: uiMsg.role,
        assistantId: context.assistantId,
        topicId,
        createdAt: meta?.createdAt ?? uiMsg.metadata?.createdAt ?? '',
        askId: meta?.parentId ?? (uiMsg.role === 'assistant' ? lastUserId : undefined),
        modelId: meta?.modelId,
        siblingsGroupId: meta?.siblingsGroupId,
        status:
          uiMsg.role === 'user'
            ? UserMessageStatus.SUCCESS
            : uiMsg.id === latestAssistantMessageId && status === 'submitted'
              ? AssistantMessageStatus.PENDING
              : uiMsg.id === latestAssistantMessageId && status === 'streaming'
                ? AssistantMessageStatus.PROCESSING
                : ((meta?.status as AssistantMessageStatus | undefined) ?? AssistantMessageStatus.SUCCESS),
        ...(meta?.stats && { usage: statsToUsage(meta.stats), metrics: statsToMetrics(meta.stats) }),
        blocks: []
      }
    })
  }, [messages, context.assistantId, topicId, status, metadataMap, latestAssistantMessageId])

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
    initialMessages,
    prepareNextAssistantId,
    addToolApprovalResponse
  }
}
